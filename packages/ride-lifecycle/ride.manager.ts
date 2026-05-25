import { redis } from '../redis/client';
import { pool } from '../database/models';
import { DriverTrackingService, DriverStatus } from '../redis/driver-tracking';
import { PubSub, REDIS_KEYS } from '../redis/client';

export enum RideStatus {
    REQUESTED = 'requested',
    SEARCHING = 'searching',
    ACCEPTED = 'accepted',
    ARRIVED = 'arrived',
    STARTED = 'started',
    COMPLETED = 'completed',
    CANCELLED_BY_RIDER = 'cancelled_by_rider',
    CANCELLED_BY_DRIVER = 'cancelled_by_driver',
    CANCELLED_NO_DRIVERS = 'cancelled_no_drivers'
}

export interface RideState {
    rideId: string;
    riderId: string;
    driverId?: string;
    status: RideStatus;
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    estimatedDistance?: number;
    estimatedDuration?: number;
    basePrice?: number;
    surgeMultiplier?: number;
    finalPrice?: number;
    startedAt?: Date;
    completedAt?: Date;
    cancelledAt?: Date;
    cancellationReason?: string;
}

export class RideLifecycleManager {
    
    // Create new ride
    static async createRide(rideData: Omit<RideState, 'status' | 'rideId'>): Promise<RideState> {
        const rideId = `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const ride: RideState = {
            rideId,
            status: RideStatus.REQUESTED,
            ...rideData
        };
        
        // Store in Redis
        await redis.hset(`ride:${rideId}`, {
            rideId,
            riderId: ride.riderId,
            status: ride.status,
            pickupLat: ride.pickupLat.toString(),
            pickupLng: ride.pickupLng.toString(),
            dropoffLat: ride.dropoffLat.toString(),
            dropoffLng: ride.dropoffLng.toString(),
            requestedAt: Date.now().toString()
        });
        
        // Store in PostgreSQL
        await pool.query(
            `INSERT INTO rides (id, rider_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, requested_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [rideId, ride.riderId, 'requested', ride.pickupLat, ride.pickupLng, ride.dropoffLat, ride.dropoffLng]
        );
        
        return ride;
    }
    
    // Driver accepts ride
    static async acceptRide(rideId: string, driverId: string): Promise<boolean> {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Check current status
            const currentStatus = await redis.hget(`ride:${rideId}`, 'status');
            
            if (currentStatus !== RideStatus.REQUESTED && currentStatus !== RideStatus.SEARCHING) {
                return false;
            }
            
            // Update status
            await redis.hset(`ride:${rideId}`, {
                status: RideStatus.ACCEPTED,
                driverId,
                acceptedAt: Date.now().toString()
            });
            
            // Update database
            await client.query(
                `UPDATE rides SET driver_id = $1, status = 'accepted', accepted_at = NOW() WHERE id = $2`,
                [driverId, rideId]
            );
            
            await client.query('COMMIT');
            
            // Update driver status
            await DriverTrackingService.setDriverStatus(driverId, DriverStatus.ON_RIDE, rideId);
            
            // Remove from available pool
            const { GeoOperations } = await import('../redis/client');
            await GeoOperations.removeDriverLocation(driverId);
            
            // Broadcast event
            await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_ACCEPTED, {
                rideId,
                driverId,
                status: RideStatus.ACCEPTED,
                timestamp: Date.now()
            });
            
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Accept ride error:', error);
            return false;
        } finally {
            client.release();
        }
    }
    
    // Driver arrives at pickup
    static async driverArrived(rideId: string, driverId: string): Promise<boolean> {
        const ride = await this.getRideState(rideId);
        
        if (!ride || ride.driverId !== driverId || ride.status !== RideStatus.ACCEPTED) {
            return false;
        }
        
        await redis.hset(`ride:${rideId}`, 'status', RideStatus.ARRIVED);
        
        await pool.query(
            `UPDATE rides SET status = 'arrived' WHERE id = $1`,
            [rideId]
        );
        
        await PubSub.publish('channel:ride:status', {
            rideId,
            status: RideStatus.ARRIVED,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    // Start ride (after passenger on board)
    static async startRide(rideId: string, driverId: string): Promise<boolean> {
        const ride = await this.getRideState(rideId);
        
        if (!ride || ride.driverId !== driverId || ride.status !== RideStatus.ARRIVED) {
            return false;
        }
        
        await redis.hset(`ride:${rideId}`, {
            status: RideStatus.STARTED,
            startedAt: Date.now().toString()
        });
        
        await pool.query(
            `UPDATE rides SET status = 'started', started_at = NOW() WHERE id = $1`,
            [rideId]
        );
        
        await PubSub.publish('channel:ride:status', {
            rideId,
            status: RideStatus.STARTED,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    // Complete ride
    static async completeRide(rideId: string, driverId: string): Promise<boolean> {
        const ride = await this.getRideState(rideId);
        
        if (!ride || ride.driverId !== driverId || ride.status !== RideStatus.STARTED) {
            return false;
        }
        
        await redis.hset(`ride:${rideId}`, {
            status: RideStatus.COMPLETED,
            completedAt: Date.now().toString()
        });
        
        // Free up driver
        await DriverTrackingService.setDriverStatus(driverId, DriverStatus.ONLINE);
        
        await PubSub.publish('channel:ride:status', {
            rideId,
            status: RideStatus.COMPLETED,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    // Cancel ride
    static async cancelRide(rideId: string, userId: string, reason: string, isDriver: boolean = false): Promise<boolean> {
        const ride = await this.getRideState(rideId);
        
        if (!ride) return false;
        
        // Check authorization
        if (isDriver && ride.driverId !== userId) return false;
        if (!isDriver && ride.riderId !== userId) return false;
        
        // Can only cancel if not completed
        if (ride.status === RideStatus.COMPLETED) return false;
        
        const cancelStatus = isDriver ? RideStatus.CANCELLED_BY_DRIVER : RideStatus.CANCELLED_BY_RIDER;
        
        await redis.hset(`ride:${rideId}`, {
            status: cancelStatus,
            cancelledAt: Date.now().toString(),
            cancellationReason: reason
        });
        
        await pool.query(
            `UPDATE rides SET status = $1, cancelled_at = NOW(), cancellation_reason = $2 WHERE id = $3`,
            [cancelStatus, reason, rideId]
        );
        
        // If driver was assigned, free them
        if (ride.driverId) {
            await DriverTrackingService.setDriverStatus(ride.driverId, DriverStatus.ONLINE);
        }
        
        await PubSub.publish('channel:ride:cancelled', {
            rideId,
            cancelledBy: isDriver ? 'driver' : 'rider',
            reason,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    // Get ride state
    static async getRideState(rideId: string): Promise<RideState | null> {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        
        if (!rideData || Object.keys(rideData).length === 0) {
            return null;
        }
        
        return {
            rideId: rideData.rideId,
            riderId: rideData.riderId,
            driverId: rideData.driverId,
            status: rideData.status as RideStatus,
            pickupLat: parseFloat(rideData.pickupLat),
            pickupLng: parseFloat(rideData.pickupLng),
            dropoffLat: parseFloat(rideData.dropoffLat),
            dropoffLng: parseFloat(rideData.dropoffLng),
            estimatedDistance: rideData.estimatedDistance ? parseFloat(rideData.estimatedDistance) : undefined,
            estimatedDuration: rideData.estimatedDuration ? parseFloat(rideData.estimatedDuration) : undefined,
            basePrice: rideData.basePrice ? parseFloat(rideData.basePrice) : undefined,
            surgeMultiplier: rideData.surgeMultiplier ? parseFloat(rideData.surgeMultiplier) : undefined,
            finalPrice: rideData.finalPrice ? parseFloat(rideData.finalPrice) : undefined,
            startedAt: rideData.startedAt ? new Date(parseInt(rideData.startedAt)) : undefined,
            completedAt: rideData.completedAt ? new Date(parseInt(rideData.completedAt)) : undefined,
            cancelledAt: rideData.cancelledAt ? new Date(parseInt(rideData.cancelledAt)) : undefined,
            cancellationReason: rideData.cancellationReason
        };
    }
}