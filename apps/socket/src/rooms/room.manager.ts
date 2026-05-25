import { Server, Socket } from 'socket.io';
import { redis, PubSub, REDIS_KEYS } from '../../../../packages/redis/client';
import { DriverTrackingService, DriverStatus } from '../../../../packages/redis/driver-tracking';

export class RoomManager {
    private io: Server;
    private riderSockets: Map<string, string> = new Map(); // riderId -> socketId
    private driverSockets: Map<string, string> = new Map(); // driverId -> socketId
    private rideRooms: Map<string, Set<string>> = new Map(); // rideId -> Set of socketIds
    
    constructor(io: Server) {
        this.io = io;
        this.setupRedisSubscribers();
    }
    
    private setupRedisSubscribers() {
        // Listen for ride acceptance across all servers
        PubSub.subscribe(REDIS_KEYS.CHANNELS.RIDE_ACCEPTED, (message) => {
            this.broadcastToRideRoom(message.rideId, 'ride:accepted', message);
        });
        
        // Listen for driver location updates
        PubSub.subscribe(REDIS_KEYS.CHANNELS.DRIVER_LOCATION, (message) => {
            if (message.rideId) {
                this.broadcastToRideRoom(message.rideId, 'driver:location:update', message);
            }
        });
        
        // Listen for ride status changes
        PubSub.subscribe('channel:ride:status', (message) => {
            this.broadcastToRideRoom(message.rideId, 'ride:status:changed', message);
        });
        
        // Listen for surge updates
        PubSub.subscribe(REDIS_KEYS.CHANNELS.SURGE_UPDATE, (message) => {
            this.io.emit('surge:updated', message);
        });
    }
    
    // Register a rider connection
    registerRider(socket: Socket, riderId: string) {
        this.riderSockets.set(riderId, socket.id);
        socket.join(`rider:${riderId}`);
        socket.data.userId = riderId;
        socket.data.role = 'rider';
        
        console.log(`Rider ${riderId} connected (${socket.id})`);
        
        // Setup rider-specific event handlers
        this.setupRiderHandlers(socket, riderId);
    }
    
    // Register a driver connection
    registerDriver(socket: Socket, driverId: string) {
        this.driverSockets.set(driverId, socket.id);
        socket.join(`driver:${driverId}`);
        socket.data.userId = driverId;
        socket.data.role = 'driver';
        
        console.log(`Driver ${driverId} connected (${socket.id})`);
        
        // Setup driver-specific event handlers
        this.setupDriverHandlers(socket, driverId);
    }
    
    // Join a ride room (for both rider and driver)
    joinRideRoom(socket: Socket, rideId: string, userId: string) {
        socket.join(`ride:${rideId}`);
        
        if (!this.rideRooms.has(rideId)) {
            this.rideRooms.set(rideId, new Set());
        }
        this.rideRooms.get(rideId)!.add(socket.id);
        
        console.log(`User ${userId} joined ride room ${rideId}`);
        
        // Send current ride state immediately
        this.sendCurrentRideState(socket, rideId);
    }
    
    // Leave a ride room
    leaveRideRoom(socket: Socket, rideId: string) {
        socket.leave(`ride:${rideId}`);
        
        const room = this.rideRooms.get(rideId);
        if (room) {
            room.delete(socket.id);
            if (room.size === 0) {
                this.rideRooms.delete(rideId);
            }
        }
    }
    
    // Broadcast to all participants in a ride
    broadcastToRideRoom(rideId: string, event: string, data: any) {
        this.io.to(`ride:${rideId}`).emit(event, data);
    }
    
    // Send message to specific rider
    sendToRider(riderId: string, event: string, data: any) {
        const socketId = this.riderSockets.get(riderId);
        if (socketId) {
            this.io.to(socketId).emit(event, data);
        }
    }
    
    // Send message to specific driver
    sendToDriver(driverId: string, event: string, data: any) {
        const socketId = this.driverSockets.get(driverId);
        if (socketId) {
            this.io.to(socketId).emit(event, data);
        }
    }
    
    // Remove disconnected user
    removeUser(socketId: string) {
        // Remove from rider map
        for (const [riderId, id] of this.riderSockets) {
            if (id === socketId) {
                this.riderSockets.delete(riderId);
                break;
            }
        }
        
        // Remove from driver map
        for (const [driverId, id] of this.driverSockets) {
            if (id === socketId) {
                this.driverSockets.delete(driverId);
                break;
            }
        }
        
        // Remove from ride rooms
        for (const [rideId, sockets] of this.rideRooms) {
            if (sockets.has(socketId)) {
                sockets.delete(socketId);
                if (sockets.size === 0) {
                    this.rideRooms.delete(rideId);
                }
            }
        }
    }
    
    // Setup rider-specific event handlers
    private setupRiderHandlers(socket: Socket, riderId: string) {
        // Request ride
        socket.on('rider:request:ride', async (data) => {
            const { RideMatchingService } = await import('../../../../packages/ride-matching/matching.service');
            
            const result = await RideMatchingService.requestRide({
                riderId,
                pickupLat: data.pickupLat,
                pickupLng: data.pickupLng,
                dropoffLat: data.dropoffLat,
                dropoffLng: data.dropoffLng
            });
            
            if (result.matchedDriver) {
                this.joinRideRoom(socket, result.rideId, riderId);
                socket.emit('ride:request:success', {
                    rideId: result.rideId,
                    driverId: result.matchedDriver.driverId,
                    eta: Math.ceil(result.matchedDriver.etaSeconds / 60),
                    distance: result.matchedDriver.distance
                });
                
                // Notify the driver
                this.sendToDriver(result.matchedDriver.driverId, 'ride:new:request', {
                    rideId: result.rideId,
                    riderId,
                    pickupLat: data.pickupLat,
                    pickupLng: data.pickupLng,
                    distance: result.matchedDriver.distance
                });
            } else {
                socket.emit('ride:request:searching', {
                    rideId: result.rideId,
                    message: 'Searching for nearby drivers...'
                });
            }
        });
        
        // Cancel ride
        socket.on('rider:cancel:ride', async (data) => {
            const { RideMatchingService } = await import('../../../../packages/ride-matching/matching.service');
            const cancelled = await RideMatchingService.cancelRide(data.rideId, riderId, data.reason || 'User cancelled');
            
            if (cancelled) {
                this.leaveRideRoom(socket, data.rideId);
                socket.emit('ride:cancelled', { rideId: data.rideId });
            }
        });
        
        // Rate driver after ride
        socket.on('rider:rate:driver', async (data) => {
            const { pool } = await import('../../../../packages/database/models');
            await pool.query(
                `UPDATE rides SET driver_rating = $1 WHERE id = $2 AND rider_id = $3`,
                [data.rating, data.rideId, riderId]
            );
            
            socket.emit('driver:rated', { success: true });
        });
    }
    
    // Setup driver-specific event handlers
    private setupDriverHandlers(socket: Socket, driverId: string) {
        // Accept ride
        socket.on('driver:accept:ride', async (data) => {
            const { RideMatchingService } = await import('../../../../packages/ride-matching/matching.service');
            const { DriverTrackingService, DriverStatus } = await import('../../../../packages/redis/driver-tracking');
            
            const rideData = await RideMatchingService.getRideStatus(data.rideId);
            
            if (!rideData || rideData.status !== 'searching') {
                socket.emit('ride:accept:failed', { 
                    rideId: data.rideId, 
                    reason: 'Ride no longer available' 
                });
                return;
            }
            
            const assigned = await RideMatchingService.assignDriverToRide(data.rideId, driverId);
            
            if (assigned) {
                await DriverTrackingService.setDriverStatus(driverId, DriverStatus.ON_RIDE, data.rideId);
                this.joinRideRoom(socket, data.rideId, driverId);
                
                // Notify rider
                this.sendToRider(rideData.riderId, 'ride:accepted', {
                    rideId: data.rideId,
                    driverId,
                    eta: Math.ceil(rideData.estimatedDistance / 30 * 60),
                    driverLocation: await DriverTrackingService.getDriverStatus(driverId)
                });
                
                socket.emit('ride:accept:success', { rideId: data.rideId });
                
                // Broadcast to all servers
                await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_ACCEPTED, {
                    rideId: data.rideId,
                    driverId,
                    status: 'accepted'
                });
            }
        });
        
        // Reject ride
        socket.on('driver:reject:ride', async (data) => {
            const { RideMatchingService } = await import('../../../../packages/ride-matching/matching.service');
            
            // Find next available driver
            const rideData = await RideMatchingService.getRideStatus(data.rideId);
            if (rideData && rideData.status === 'searching') {
                // Trigger re-match with next driver
                await PubSub.publish('channel:ride:rematch', {
                    rideId: data.rideId,
                    rejectedDriverId: driverId
                });
            }
            
            socket.emit('ride:rejected', { rideId: data.rideId });
        });
        
        // Update driver location (enhanced)
        socket.on('driver:location:live', async (data) => {
            await DriverTrackingService.updateLocation(
                driverId,
                data.lat,
                data.lng,
                data.status as DriverStatus,
                data.rideId
            );
            
            // If on a ride, broadcast to rider
            if (data.rideId && data.status === DriverStatus.ON_RIDE) {
                const rideData = await redis.hgetall(`ride:${data.rideId}`);
                if (rideData && rideData.riderId) {
                    this.sendToRider(rideData.riderId, 'driver:location:update', {
                        driverId,
                        lat: data.lat,
                        lng: data.lng,
                        heading: data.heading,
                        speed: data.speed,
                        timestamp: Date.now()
                    });
                }
            }
            
            socket.emit('location:ack', { timestamp: Date.now() });
        });
        
        // Driver arrived at pickup
        socket.on('driver:arrived', async (data) => {
            await redis.hset(`ride:${data.rideId}`, 'status', 'arrived');
            
            const rideData = await redis.hgetall(`ride:${data.rideId}`);
            if (rideData && rideData.riderId) {
                this.sendToRider(rideData.riderId, 'driver:arrived', {
                    rideId: data.rideId,
                    message: 'Your driver has arrived'
                });
            }
            
            socket.emit('arrived:confirmed', { rideId: data.rideId });
        });
        
        // Start ride
        socket.on('driver:start:ride', async (data) => {
            await redis.hset(`ride:${data.rideId}`, {
                status: 'started',
                startedAt: Date.now().toString()
            });
            
            const rideData = await redis.hgetall(`ride:${data.rideId}`);
            if (rideData && rideData.riderId) {
                this.sendToRider(rideData.riderId, 'ride:started', {
                    rideId: data.rideId,
                    message: 'Your ride has started'
                });
            }
            
            socket.emit('ride:started:confirmed', { rideId: data.rideId });
        });
        
        // Complete ride
        socket.on('driver:complete:ride', async (data) => {
            const rideData = await redis.hgetall(`ride:${data.rideId}`);
            
            await redis.hset(`ride:${data.rideId}`, {
                status: 'completed',
                completedAt: Date.now().toString()
            });
            
            // Calculate final fare
            const duration = (Date.now() - parseInt(rideData.startedAt)) / 1000 / 60; // minutes
            const finalPrice = await this.calculateFinalFare(rideData, duration);
            
            // Update database
            const { pool } = await import('../../../../packages/database/models');
            await pool.query(
                `UPDATE rides SET 
                    status = 'completed', 
                    completed_at = NOW(),
                    actual_duration_min = $1,
                    total_price = $2
                 WHERE id = $3`,
                [duration, finalPrice, data.rideId]
            );
            
            if (rideData && rideData.riderId) {
                this.sendToRider(rideData.riderId, 'ride:completed', {
                    rideId: data.rideId,
                    finalPrice,
                    duration: Math.ceil(duration)
                });
            }
            
            // Free up the driver
            await DriverTrackingService.setDriverStatus(driverId, DriverStatus.ONLINE);
            
            socket.emit('ride:completed:confirmed', { 
                rideId: data.rideId, 
                finalPrice 
            });
            
            this.leaveRideRoom(socket, data.rideId);
        });
    }
    
    private async sendCurrentRideState(socket: Socket, rideId: string) {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        if (rideData && Object.keys(rideData).length > 0) {
            socket.emit('ride:state', {
                rideId,
                status: rideData.status,
                driverId: rideData.driverId,
                pickupLat: parseFloat(rideData.pickupLat),
                pickupLng: parseFloat(rideData.pickupLng),
                dropoffLat: parseFloat(rideData.dropoffLat),
                dropoffLng: parseFloat(rideData.dropoffLng)
            });
        }
    }
    
    private async calculateFinalFare(rideData: any, durationMinutes: number): Promise<number> {
        const distance = parseFloat(rideData.estimatedDistance);
        const baseFare = 2.50;
        const perKm = 1.50;
        const perMinute = 0.30;
        const surge = parseFloat(rideData.surgeMultiplier || '1');
        
        return parseFloat(((baseFare + (distance * perKm) + (durationMinutes * perMinute)) * surge).toFixed(2));
    }
}