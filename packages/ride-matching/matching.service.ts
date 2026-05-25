import { redis, GeoOperations, REDIS_KEYS, PubSub } from '../redis/client';
import { pool } from '../database/models';
import { DriverTrackingService, DriverStatus } from '../redis/driver-tracking';
import { ZoneManager } from '../zones/zone.manager';

export interface RideRequest {
    riderId: string;
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    rideType?: 'standard' | 'premium' | 'shared';
}

export interface DriverMatch {
    driverId: string;
    distance: number;
    etaSeconds: number;
    score: number;
}

export class RideMatchingService {
    private static readonly SEARCH_RADIUS_KM = 5;
    private static readonly MAX_WAIT_TIME_SECONDS = 60;
    private static readonly MAX_MATCHING_ATTEMPTS = 3;


    // Driver arrived at pickup location
    static async markDriverArrived(rideId: string, driverId: string): Promise<boolean> {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        
        if (!rideData || rideData.driverId !== driverId) return false;
        if (rideData.status !== 'accepted') return false;

        await redis.hset(`ride:${rideId}`, {
            status: 'arrived',
            arrivedAt: Date.now().toString()
        });

        await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_EVENTS, {
            type: 'driver_arrived',
            rideId,
            driverId
        });

        return true;
    }

    // Start the ride (trip begins)
    static async startRide(rideId: string, driverId: string): Promise<boolean> {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        
        if (!rideData || rideData.driverId !== driverId) return false;
        if (rideData.status !== 'arrived') return false;

        await redis.hset(`ride:${rideId}`, {
            status: 'started',
            startedAt: Date.now().toString()
        });

        await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_EVENTS, {
            type: 'ride_started',
            rideId,
            driverId
        });

        return true;
    }

    // Complete the ride
    static async completeRide(rideId: string, driverId: string, finalPrice?: number): Promise<boolean> {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        
        if (!rideData || rideData.driverId !== driverId) return false;
        if (!['started', 'arrived'].includes(rideData.status)) return false;

        const price = finalPrice || parseFloat(rideData.finalPrice || rideData.basePrice);

        await redis.hset(`ride:${rideId}`, {
            status: 'completed',
            completedAt: Date.now().toString(),
            finalPrice: price.toString()
        });

        // Return driver to online
        await DriverTrackingService.setDriverStatus(driverId, DriverStatus.ONLINE);

        // Add driver back to geo pool (optional - you can implement re-adding location)
        // await GeoOperations.addDriverLocation(...)

        await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_EVENTS, {
            type: 'ride_completed',
            rideId,
            driverId,
            finalPrice: price
        });

        // Update database
        await pool.query(
            `UPDATE rides SET status = $1, completed_at = NOW(), total_price = $2 WHERE id = $3`,
            ['completed', price, rideId]
        );

        return true;
    }

    // Driver rejects ride
    static async rejectRide(rideId: string, driverId: string, reason?: string): Promise<boolean> {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        
        if (!rideData || rideData.driverId !== driverId) return false;
        if (rideData.status !== 'accepted') return false;

        await redis.hset(`ride:${rideId}`, {
            status: 'searching',
            driverId: '',
            rejectedAt: Date.now().toString(),
            rejectReason: reason || 'Driver rejected'
        });

        await DriverTrackingService.setDriverStatus(driverId, DriverStatus.ONLINE);

        await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_EVENTS, {
            type: 'ride_rejected',
            rideId,
            driverId,
            reason: reason || 'Driver rejected'
        });

        // Restart background search
        // this.startBackgroundSearch(rideId, ...); // You can re-trigger if needed

        return true;
    }

    // Get current active ride for user
    static async getActiveRide(userId: string): Promise<any> {
        const result = await pool.query(
            `SELECT id as rideId, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
                    driver_id, rider_id, total_price, requested_at
             FROM rides 
             WHERE (rider_id = $1 OR driver_id = $1)
             AND status IN ('searching', 'accepted', 'arrived', 'started')
             ORDER BY requested_at DESC 
             LIMIT 1`,
            [userId]
        );

        return result.rows[0] || null;
    }

    // Submit rating
    static async submitRating(rideId: string, userId: string, rating: number, comment?: string): Promise<boolean> {
        if (rating < 1 || rating > 5) return false;

        const rideData = await redis.hgetall(`ride:${rideId}`);
        if (!rideData) return false;

        const isRider = rideData.riderId === userId;
        const field = isRider ? 'riderRating' : 'driverRating';

        await redis.hset(`ride:${rideId}`, field, rating.toString());
        if (comment) await redis.hset(`ride:${rideId}`, `${field}Comment`, comment);

        // Update PostgreSQL
        await pool.query(
            `UPDATE rides 
             SET ${isRider ? 'rider_rating = $1, rider_comment = $2' : 'driver_rating = $1, driver_comment = $2'}
             WHERE id = $3`,
            [rating, comment || null, rideId]
        );

        return true;
    }
    
    // Find nearest driver using Redis GEORADIUS
    static async findNearestDriver(
        lat: number, 
        lng: number, 
        radiusKm: number = this.SEARCH_RADIUS_KM
    ): Promise<DriverMatch | null> {
        // Get all drivers within radius, sorted by distance
        const drivers = await redis.georadius(
            REDIS_KEYS.DRIVERS_ONLINE,
            lng,
            lat,
            radiusKm,
            'km',
            'ASC',  // Sort by distance (nearest first)
            'WITHCOORD',
            'WITHDIST'
        );
        
        if (!drivers || drivers.length === 0) {
            return null;
        }
        
        // Find first available driver (not on ride)
        for (const driver of drivers as any[]) {
            const driverId = driver[0];
            const distance = parseFloat(driver[1]);
            const coordinates = driver[2];
            
            // Check driver availability status
            const driverStatus = await DriverTrackingService.getDriverStatus(driverId);
            
            if (driverStatus && driverStatus.status === DriverStatus.ONLINE) {
                // Calculate estimated ETA (simplified: distance / avg speed)
                const avgSpeedKmph = 30; // 30 km/h average city speed
                const etaSeconds = (distance / avgSpeedKmph) * 3600;
                
                // Calculate match score (lower is better)
                const score = distance * 10 + etaSeconds / 60;
                
                return {
                    driverId,
                    distance,
                    etaSeconds,
                    score
                };
            }
        }
        
        return null;
    }
    
    // Get multiple nearby drivers for rider choice
    static async findNearbyDrivers(
        lat: number,
        lng: number,
        radiusKm: number = this.SEARCH_RADIUS_KM,
        maxDrivers: number = 10
    ): Promise<DriverMatch[]> {
        const drivers = await redis.georadius(
            REDIS_KEYS.DRIVERS_ONLINE,
            lng,
            lat,
            radiusKm,
            'km',
            'ASC',
            'WITHCOORD',
            'WITHDIST'
        );
        
        const availableDrivers: DriverMatch[] = [];
        
        for (const driver of (drivers as any[]).slice(0, maxDrivers)) {
            const driverId = driver[0];
            const distance = parseFloat(driver[1]);
            
            const driverStatus = await DriverTrackingService.getDriverStatus(driverId);
            
            if (driverStatus && driverStatus.status === DriverStatus.ONLINE) {
                const avgSpeedKmph = 30;
                const etaSeconds = (distance / avgSpeedKmph) * 3600;
                const score = distance * 10 + etaSeconds / 60;
                
                availableDrivers.push({
                    driverId,
                    distance,
                    etaSeconds,
                    score
                });
            }
        }
        
        return availableDrivers;
    }

    static async calculatePriceWithSurge(
    basePrice: number,
    lat: number,
    lng: number
): Promise<{ finalPrice: number; surgeMultiplier: number }> {
    const multiplier = await ZoneManager.getSurgeMultiplier(lat, lng);
    return {
        finalPrice: basePrice * multiplier,
        surgeMultiplier: multiplier
    };
}
    
    // Create a new ride request
    static async requestRide(rideRequest: RideRequest): Promise<{
    rideId: string;
    matchedDriver: DriverMatch | null;
    status: string;
    surgeMultiplier: number;
    finalPrice: number;
}> {
    const { riderId, pickupLat, pickupLng, dropoffLat, dropoffLng } = rideRequest;

    // Find nearest driver
    const matchedDriver = await this.findNearestDriver(pickupLat, pickupLng);

    // Generate unique ride ID
    const rideId = `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Calculate distances and base price
    const estimatedDistance = this.calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
    const basePrice = this.calculateBasePrice(estimatedDistance);

    // === SURGE PRICING ===
    const surgeMultiplier = await ZoneManager.getSurgeMultiplier(pickupLat, pickupLng);
    const finalPrice = basePrice * surgeMultiplier;

    // Store ride in Redis
    const rideData = {
        rideId,
        riderId,
        driverId: matchedDriver?.driverId || '',
        status: matchedDriver ? 'accepted' : 'searching',
        pickupLat: pickupLat.toString(),
        pickupLng: pickupLng.toString(),
        dropoffLat: dropoffLat.toString(),
        dropoffLng: dropoffLng.toString(),
        estimatedDistance: estimatedDistance.toString(),
        basePrice: basePrice.toString(),
        surgeMultiplier: surgeMultiplier.toString(),
        finalPrice: finalPrice.toString(),
        requestedAt: Date.now().toString(),
        matchingAttempts: '0'
    };

    await redis.hset(`ride:${rideId}`, rideData);
    await redis.expire(`ride:${rideId}`, 300); // 5 minutes

    if (matchedDriver) {
        // Assign driver immediately
        await this.assignDriverToRide(rideId, matchedDriver.driverId);

        // Update driver status
        await DriverTrackingService.setDriverStatus(
            matchedDriver.driverId, 
            DriverStatus.ON_RIDE, 
            rideId
        );

        // Remove from available pool
        await GeoOperations.removeDriverLocation(matchedDriver.driverId);

        // Notify driver via Pub/Sub
        await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_REQUEST, {
            rideId,
            driverId: matchedDriver.driverId,
            pickupLat,
            pickupLng,
            dropoffLat,
            dropoffLng,
            distance: matchedDriver.distance,
            eta: matchedDriver.etaSeconds,
            surgeMultiplier,
            finalPrice
        });

        // Save to PostgreSQL
        await this.saveRideToDatabase({
            id: rideId,
            riderId,
            driverId: matchedDriver.driverId,
            status: 'accepted',
            pickupLat,
            pickupLng,
            dropoffLat,
            dropoffLng,
            estimatedDistanceKm: estimatedDistance,
            basePrice,
            surgeMultiplier,
            totalPrice: finalPrice   // Use final price
        });
    } else {
        // No driver available - start background search
        this.startBackgroundSearch(rideId, rideRequest);
    }

    return {
        rideId,
        matchedDriver: matchedDriver || null,
        status: matchedDriver ? 'accepted' : 'searching',
        surgeMultiplier,
        finalPrice
    };
}
   
    // Assign driver to ride with atomic operation
    static async assignDriverToRide(rideId: string, driverId: string): Promise<boolean> {
        // Use Lua script for atomic check-and-set
        const luaScript = `
            local ride_key = KEYS[1]
            local current_status = redis.call('hget', ride_key, 'status')
            
            if current_status == 'searching' or current_status == 'pending' then
                redis.call('hset', ride_key, 'status', 'accepted')
                redis.call('hset', ride_key, 'driverId', ARGV[1])
                redis.call('hset', ride_key, 'acceptedAt', ARGV[2])
                return 1
            else
                return 0
            end
        `;
        
        const result = await redis.eval(
            luaScript,
            1,
            `ride:${rideId}`,
            driverId,
            Date.now().toString()
        );
        
        return result === 1;
    }
    
    // Background search for drivers (when no immediate match)
    private static async startBackgroundSearch(rideId: string, rideRequest: RideRequest): Promise<void> {
        const { riderId, pickupLat, pickupLng, dropoffLat, dropoffLng } = rideRequest;
        
        let attempt = 0;
        const maxAttempts = this.MAX_MATCHING_ATTEMPTS;
        const searchRadii = [3, 5, 10]; // Expand search radius with each attempt
        
        const searchInterval = setInterval(async () => {
            attempt++;
            const radius = searchRadii[Math.min(attempt - 1, searchRadii.length - 1)];
            
            // Check if ride is still active
            const rideStatus = await redis.hget(`ride:${rideId}`, 'status');
            if (rideStatus !== 'searching') {
                clearInterval(searchInterval);
                return;
            }
            
            // Update attempt count
            await redis.hincrby(`ride:${rideId}`, 'matchingAttempts', 1);
            
            // Search for drivers with wider radius
            const matchedDriver = await this.findNearestDriver(pickupLat, pickupLng, radius);
            
            if (matchedDriver) {
                clearInterval(searchInterval);
                
                // Assign driver
                const assigned = await this.assignDriverToRide(rideId, matchedDriver.driverId);
                
                if (assigned) {
                    await DriverTrackingService.setDriverStatus(matchedDriver.driverId, DriverStatus.ON_RIDE, rideId);
                    await GeoOperations.removeDriverLocation(matchedDriver.driverId);
                    
                    // Notify via WebSocket
                    await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_REQUEST, {
                        rideId,
                        driverId: matchedDriver.driverId,
                        pickupLat,
                        pickupLng,
                        dropoffLat,
                        dropoffLng,
                        distance: matchedDriver.distance,
                        eta: matchedDriver.etaSeconds
                    });
                    
                    // Notify rider
                    await PubSub.publish('channel:ride:found', {
                        rideId,
                        riderId,
                        driverId: matchedDriver.driverId,
                        eta: matchedDriver.etaSeconds
                    });
                }
            } else if (attempt >= maxAttempts) {
                // No driver found after all attempts
                clearInterval(searchInterval);
                await redis.hset(`ride:${rideId}`, 'status', 'cancelled_no_drivers');
                
                await PubSub.publish('channel:ride:failed', {
                    rideId,
                    riderId,
                    reason: 'No drivers available'
                });
            }
        }, 5000); // Search every 5 seconds
    }
    
    // Cancel ride
    static async cancelRide(rideId: string, riderId: string, reason: string): Promise<boolean> {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        
        if (!rideData || rideData.riderId !== riderId) {
            return false;
        }
        
        const currentStatus = rideData.status;
        
        if (currentStatus === 'completed' || currentStatus === 'cancelled') {
            return false;
        }
        
        // Update ride status
        await redis.hset(`ride:${rideId}`, {
            status: 'cancelled_by_rider',
            cancelledAt: Date.now().toString(),
            cancellationReason: reason
        });
        
        // If driver was assigned, free them
        if (rideData.driverId && (currentStatus === 'accepted' || currentStatus === 'started')) {
            await DriverTrackingService.setDriverStatus(rideData.driverId, DriverStatus.ONLINE);
            
            // Notify driver
            await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_REQUEST, {
                type: 'ride_cancelled',
                rideId,
                driverId: rideData.driverId,
                reason
            });
        }
        
        // Update database
        await pool.query(
            `UPDATE rides SET status = $1, cancelled_at = NOW(), cancellation_reason = $2 WHERE id = $3`,
            ['cancelled_by_rider', reason, rideId]
        );
        
        return true;
    }
    
    // Get ride status
    static async getRideStatus(rideId: string): Promise<any> {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        
        if (!rideData || Object.keys(rideData).length === 0) {
            return null;
        }
        
        return {
            rideId: rideData.rideId,
            status: rideData.status,
            driverId: rideData.driverId,
            pickupLat: parseFloat(rideData.pickupLat),
            pickupLng: parseFloat(rideData.pickupLng),
            dropoffLat: parseFloat(rideData.dropoffLat),
            dropoffLng: parseFloat(rideData.dropoffLng),
            estimatedDistance: parseFloat(rideData.estimatedDistance),
            basePrice: parseFloat(rideData.basePrice),
            requestedAt: new Date(parseInt(rideData.requestedAt)),
            acceptedAt: rideData.acceptedAt ? new Date(parseInt(rideData.acceptedAt)) : null
        };
    }
    
    // Helper: Calculate distance between coordinates
    static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    
    private static toRad(degrees: number): number {
        return degrees * (Math.PI / 180);
    }
    
    // Helper: Calculate base price
    static calculateBasePrice(distanceKm: number): number {
        const baseFare = 2.50;
        const perKmRate = 1.50;
        const perMinuteRate = 0.30;
        const estimatedMinutes = (distanceKm / 30) * 60; // 30 km/h average
        
        return parseFloat((baseFare + (distanceKm * perKmRate) + (estimatedMinutes * perMinuteRate)).toFixed(2));
    }
    
    // Save ride to PostgreSQL
    private static async saveRideToDatabase(rideData: any): Promise<void> {
        const query = `
            INSERT INTO rides (
                id, rider_id, driver_id, status, 
                pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
                estimated_distance_km, base_price, requested_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (id) DO UPDATE SET
                driver_id = EXCLUDED.driver_id,
                status = EXCLUDED.status,
                accepted_at = NOW()
        `;
        
        await pool.query(query, [
            rideData.id,
            rideData.riderId,
            rideData.driverId,
            rideData.status,
            rideData.pickupLat,
            rideData.pickupLng,
            rideData.dropoffLat,
            rideData.dropoffLng,
            rideData.estimatedDistanceKm,
            rideData.totalPrice
        ]);
    }
}