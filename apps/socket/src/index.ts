import { Server } from 'socket.io';
import { createServer } from 'http';
import { redis, PubSub, REDIS_KEYS, GeoOperations } from '../../../packages/redis/client';
import { verifyAccessToken } from '../../../packages/auth/jwt';
import { DriverTrackingService, DriverStatus } from '../../../packages/redis/driver-tracking';
import { RoomManager } from './rooms/room.manager';
import { AdminMetricsService } from '../../../packages/admin/metrics.service';

const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
});

// Track connected users
const riderSockets = new Map<string, string>();
const driverSockets = new Map<string, string>();

const roomManager = new RoomManager(io);

// Authentication middleware
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return next(new Error('Authentication required'));
    }
    
    const payload = verifyAccessToken(token);
    if (!payload) {
        return next(new Error('Invalid token'));
    }
    
    socket.data.userId = payload.userId;
    socket.data.role = payload.role;
    next();
});

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}, User: ${socket.data.userId}, Role: ${socket.data.role}`);
    
    // Register user based on role
    if (socket.data.role === 'rider') {
        roomManager.registerRider(socket, socket.data.userId);
    } else if (socket.data.role === 'driver') {
        roomManager.registerDriver(socket, socket.data.userId);
    }
    
    // Join specific ride room
    socket.on('join:ride', (data: { rideId: string }) => {
        roomManager.joinRideRoom(socket, data.rideId, socket.data.userId);
    });
    
    // Leave ride room
    socket.on('leave:ride', (data: { rideId: string }) => {
        roomManager.leaveRideRoom(socket, data.rideId);
    });
    
    // Ping/pong for connection health
    socket.on('ping', () => {
        socket.emit('pong', Date.now());
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        roomManager.removeUser(socket.id);
    });
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('auth', async (data: { token: string }) => {
        try {
            if (!data.token) {
                socket.emit('auth_error', { message: 'Token is required' });
                return;
            }

            const payload = verifyAccessToken(data.token);
            if (!payload?.userId || !payload?.role) {
                socket.emit('auth_error', { message: 'Invalid token' });
                return;
            }

            // Attach user data to socket
            socket.data.userId = payload.userId;
            socket.data.role = payload.role;

            // Join rooms
            socket.join(`user:${payload.userId}`);
            socket.join(`role:${payload.role}`);

            // Store socket mapping
            if (payload.role === 'rider') {
                riderSockets.set(payload.userId, socket.id);
            } else if (payload.role === 'driver') {
                driverSockets.set(payload.userId, socket.id);
            }

            socket.emit('auth_success', {
                userId: payload.userId,
                role: payload.role,
                message: 'Authenticated successfully'
            });

            console.log(`✅ ${payload.role} authenticated:`, payload.userId);
        } catch (error) {
            console.error('Auth error:', error);
            socket.emit('auth_error', { message: 'Authentication failed' });
            socket.disconnect(true);
        }
    });

    socket.on('driver:location', async (data: { lat: number; lng: number; status: string }) => {
        const driverId = socket.data.userId;
        if (!driverId || socket.data.role !== 'driver') return;

        if (data.status === 'online') {
            await GeoOperations.addDriverLocation(driverId, data.lat, data.lng);
        } else if (data.status === 'offline') {
            await GeoOperations.removeDriverLocation(driverId);
        }

        // Broadcast location update
        io.to(`user:${driverId}`).emit('location_update', {
            driverId,
            lat: data.lat,
            lng: data.lng,
            timestamp: Date.now(),
        });
    });

    socket.on('rider:request_ride', async (data: {
        pickupLat: number;
        pickupLng: number;
        dropoffLat: number;
        dropoffLng: number;
    }) => {
        const riderId = socket.data.userId;
        if (!riderId || socket.data.role !== 'rider') return;

        const nearbyDrivers = await GeoOperations.findNearbyDrivers(data.pickupLat, data.pickupLng, 5); // 5km radius

        if (nearbyDrivers.length === 0) {
            socket.emit('ride:no_drivers', { message: 'No drivers available nearby' });
            return;
        }

        const rideId = `ride_${Date.now()}_${riderId}`;

        // Store ride in Redis
        await redis.hset(`ride:${rideId}`, {
            riderId,
            pickupLat: data.pickupLat,
            pickupLng: data.pickupLng,
            dropoffLat: data.dropoffLat,
            dropoffLng: data.dropoffLng,
            status: 'searching',
            requestedAt: Date.now(),
        });

        // Notify nearby drivers
        nearbyDrivers.forEach(driverId => {
            const driverSocketId = driverSockets.get(driverId);
            if (driverSocketId) {
                io.to(driverSocketId).emit('ride:new_request', {
                    rideId,
                    pickupLat: data.pickupLat,
                    pickupLng: data.pickupLng,
                    distance: 'Nearby',
                });
            }
        });

        socket.emit('ride:searching', { rideId, message: 'Searching for drivers...' });
    });

    socket.on('driver:accept_ride', async (data: { rideId: string }) => {
        const driverId = socket.data.userId;
        if (!driverId || socket.data.role !== 'driver') return;

        const rideKey = `ride:${data.rideId}`;
        const status = await redis.hget(rideKey, 'status');

        if (status !== 'searching') {
            socket.emit('ride:accept_failed', { message: 'Ride is no longer available' });
            return;
        }

        await redis.hset(rideKey, {
            status: 'accepted',
            driverId,
            acceptedAt: Date.now(),
        });

        // Remove driver from available pool
        await GeoOperations.removeDriverLocation(driverId);

        const riderId = await redis.hget(rideKey, 'riderId');

        if (riderId) {
            const riderSocketId = riderSockets.get(riderId);
            if (riderSocketId) {
                io.to(riderSocketId).emit('ride:accepted', {
                    rideId: data.rideId,
                    driverId,
                    message: 'Driver accepted your ride'
                });
            }
        }

        socket.emit('ride:accept_success', { rideId: data.rideId });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        const userId = socket.data.userId;
        const role = socket.data.role;

        if (userId) {
            if (role === 'rider') riderSockets.delete(userId);
            if (role === 'driver') driverSockets.delete(userId);
        }
    });

// Driver location streaming with heartbeat
socket.on('driver:tracking:start', async (data: { 
    interval?: number // milliseconds between updates
}) => {
    const driverId = socket.data.userId;
    if (!driverId || socket.data.role !== 'driver') return;
    
    console.log(`Driver ${driverId} started tracking`);
    
    // Set up heartbeat interval for this socket
    const heartbeatInterval = setInterval(async () => {
        if (!socket.connected) {
            clearInterval(heartbeatInterval);
            return;
        }
        
        // Check if driver still has active session
        const status = await DriverTrackingService.getDriverStatus(driverId);
        if (!status || status.status === DriverStatus.OFFLINE) {
            clearInterval(heartbeatInterval);
            socket.emit('driver:tracking:timeout', { message: 'No recent location updates' });
        }
    }, 30000); // Check every 30 seconds
    
    socket.on('driver:location:update', async (locationData: {
        lat: number;
        lng: number;
        status: DriverStatus;
        heading?: number; // direction in degrees
        speed?: number; // km/h
        accuracy?: number; // meters
    }) => {
        try {
            // Update location in Redis
            await DriverTrackingService.updateLocation(
                driverId,
                locationData.lat,
                locationData.lng,
                locationData.status,
                socket.data.currentRideId
            );
            
            // If driver is on a ride, broadcast to rider
            if (locationData.status === DriverStatus.ON_RIDE && socket.data.currentRideId) {
                const rideId = socket.data.currentRideId;
                
                // Get rider ID from ride data
                const riderId = await redis.hget(`ride:${rideId}`, 'riderId');
                if (riderId) {
                    // Broadcast to rider's room
                    io.to(`rider:${riderId}`).emit('driver:location:live', {
                        driverId,
                        lat: locationData.lat,
                        lng: locationData.lng,
                        heading: locationData.heading,
                        speed: locationData.speed,
                        timestamp: Date.now()
                    });
                }
            }
            
            // Acknowledge receipt
            socket.emit('driver:location:ack', { timestamp: Date.now() });
            
        } catch (error) {
            console.error('Location update error:', error);
            socket.emit('driver:location:error', { message: 'Failed to update location' });
        }
    });
    
    // Clean up on disconnect
    socket.once('disconnect', async () => {
        clearInterval(heartbeatInterval);
        console.log(`Driver ${driverId} stopped tracking`);
        
        // Mark as offline if they disconnect without going offline first
        const status = await DriverTrackingService.getDriverStatus(driverId);
        if (status && status.status === DriverStatus.ONLINE) {
            await DriverTrackingService.setDriverStatus(driverId, DriverStatus.OFFLINE);
            await GeoOperations.removeDriverLocation(driverId);
        }
    });
});

// Get nearby drivers (rider request)
socket.on('rider:nearby:drivers', async (data: { lat: number; lng: number; radius?: number }) => {
    const riderId = socket.data.userId;
    if (!riderId || socket.data.role !== 'rider') return;
    
    const radius = data.radius || 5;
    const nearbyDrivers = await GeoOperations.findNearbyDrivers(data.lat, data.lng, radius);
    
    // Get detailed info for each nearby driver
    const drivers = await Promise.all(
        nearbyDrivers.map(async (driverId) => {
            const info = await DriverTrackingService.getDriverStatus(driverId);
            return info ? {
                driverId,
                lat: info.lastLocation.lat,
                lng: info.lastLocation.lng,
                distance: calculateDistance(data.lat, data.lng, info.lastLocation.lat, info.lastLocation.lng),
                vehicleModel: info.vehicleModel
            } : null;
        })
    );
    
    socket.emit('rider:nearby:drivers:result', {
        drivers: drivers.filter(d => d !== null),
        count: drivers.filter(d => d !== null).length,
        timestamp: Date.now()
    });
});

// Rider requests ride via WebSocket
socket.on('rider:request:ride', async (data: {
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
}) => {
    const riderId = socket.data.userId;
    if (!riderId || socket.data.role !== 'rider') return;
    
    // Import matching service
    const { RideMatchingService } = await import('../../../packages/ride-matching/matching.service');
    
    const result = await RideMatchingService.requestRide({
        riderId,
        pickupLat: data.pickupLat,
        pickupLng: data.pickupLng,
        dropoffLat: data.dropoffLat,
        dropoffLng: data.dropoffLng
    });
    
    if (result.matchedDriver) {
        socket.emit('ride:matched', {
            rideId: result.rideId,
            driverId: result.matchedDriver.driverId,
            eta: result.matchedDriver.etaSeconds,
            distance: result.matchedDriver.distance
        });
        
        // Join ride room for updates
        socket.join(`ride:${result.rideId}`);
    } else {
        socket.emit('ride:searching', {
            rideId: result.rideId,
            message: 'Looking for drivers...'
        });
    }
});

// Driver accepts ride (WebSocket version)
socket.on('driver:accept:ride', async (data: { rideId: string }) => {
    const driverId = socket.data.userId;
    if (!driverId || socket.data.role !== 'driver') return;
    
    const { RideMatchingService } = await import('../../../packages/ride-matching/matching.service');
    const { DriverTrackingService, DriverStatus } = await import('../../../packages/redis/driver-tracking');
    
    const rideData = await RideMatchingService.getRideStatus(data.rideId);
    
    if (!rideData || rideData.status !== 'searching') {
        socket.emit('error', { message: 'Ride no longer available' });
        return;
    }
    
    const assigned = await RideMatchingService.assignDriverToRide(data.rideId, driverId);
    
    if (assigned) {
        await DriverTrackingService.setDriverStatus(driverId, DriverStatus.ON_RIDE, data.rideId);
        
        // Notify rider in the ride room
        socket.to(`ride:${data.rideId}`).emit('ride:accepted', {
            rideId: data.rideId,
            driverId,
            eta: Math.ceil(rideData.estimatedDistance / 30 * 60)
        });
        
        socket.emit('ride:accept:success', { rideId: data.rideId });
    }
});

// Admin specific handlers
socket.on('admin:subscribe', async () => {
    if (socket.data.role !== 'admin') return;
    
    // Send initial metrics
    const metrics = await AdminMetricsService.getRealtimeMetrics();
    socket.emit('admin:metrics:update', metrics);
    
    // Subscribe to metrics updates
    const interval = setInterval(async () => {
        if (!socket.connected) {
            clearInterval(interval);
            return;
        }
        const updatedMetrics = await AdminMetricsService.getRealtimeMetrics();
        socket.emit('admin:metrics:update', updatedMetrics);
    }, 10000);
    
    socket.once('disconnect', () => clearInterval(interval));
});

// Subscribe to Redis channels and forward to WebSocket clients
PubSub.subscribe('channel:ride:found', async (message) => {
    const { rideId, riderId, driverId, eta } = message;
    const riderSocket = riderSockets.get(riderId);
    if (riderSocket) {
        io.to(riderSocket).emit('ride:found', {
            rideId,
            driverId,
            eta,
            message: 'Driver found!'
        });
    }
});

PubSub.subscribe('channel:ride:failed', (message) => {
    const { rideId, riderId, reason } = message;
    const riderSocket = riderSockets.get(riderId);
    if (riderSocket) {
        io.to(riderSocket).emit('ride:failed', {
            rideId,
            reason,
            message: 'No drivers available. Please try again.'
        });
    }
});

// Helper: Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}
});

// Redis Pub/Sub Forwarding
PubSub.subscribe(REDIS_KEYS.CHANNELS.RIDE_ACCEPTED, (message) => {
    try {
        const parsed = typeof message === 'string' ? JSON.parse(message) : message;
        io.emit('ride:update', parsed);
    } catch (err) {
        console.error('PubSub error:', err);
    }
});

const PORT = process.env.SOCKET_PORT || 3002;
httpServer.listen(PORT, () => {
    console.log(`🔌 WebSocket Server running on port ${PORT}`);
});