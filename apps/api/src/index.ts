import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { redis, GeoOperations, rateLimit, PubSub, REDIS_KEYS } from '../../../packages/redis/client';
import http from 'http';
import { Server } from 'socket.io';
import authRoutes from "./routes/auth.routes"
import { authenticate, requireRole } from './middleware/auth.middleware';
import driverRoutes from './routes/driver.routes';
import rideRoutes from './routes/ride.routes';
import routingRoutes from './routes/routing.routes';
import surgeROute from './routes/surge.routes'
import adminRoute from './routes/admin.routes'
const app = express();
const PORT = process.env.PORT || 3001;

import dotenv from 'dotenv'
dotenv.config()

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/routing', routingRoutes)
app.use('/api/surge', surgeROute)
app.use('/api/admin', adminRoute)

app.get('/api/driver/dashboard', authenticate, requireRole('driver'), async (req, res) => {
    res.json({ 
        message: 'Driver dashboard',
        userId: req.user?.userId 
    });
});

app.get('/api/admin/metrics', authenticate, requireRole('admin'), async (req, res) => {
    res.json({ 
        message: 'Admin metrics',
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


// Update driver location (called every 3-5 sec by driver app)
app.post('/api/driver/location', async (req: Request, res: Response) => {
    const { driverId, latitude, longitude, status } = req.body;
    
    if (!driverId || !latitude || !longitude) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Rate limit: 10 updates per 10 seconds
    const allowed = await rateLimit(driverId, 'update_location', 10, 10);
    if (!allowed) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    
    // Store in Redis GEO index (only if online)
    if (status === 'online') {
        await GeoOperations.addDriverLocation(driverId, latitude, longitude);
        
        // Also publish location for real-time tracking
        await PubSub.publish(REDIS_KEYS.CHANNELS.DRIVER_LOCATION, {
            driverId,
            latitude,
            longitude,
            timestamp: Date.now(),
        });
    } else {
        await GeoOperations.removeDriverLocation(driverId);
    }
    
    res.json({ success: true });
});


// Request a ride
app.post('/api/rides/request', async (req: Request, res: Response) => {
    const { riderId, pickupLat, pickupLng, dropoffLat, dropoffLng } = req.body;
    
    if (!riderId || !pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Rate limit: 3 ride requests per minute
    const allowed = await rateLimit(riderId, 'request_ride', 3, 60);
    if (!allowed) {
        return res.status(429).json({ error: 'Too many ride requests' });
    }
    
    // Find nearby drivers (within 3km radius)
    const nearbyDrivers = await GeoOperations.findNearbyDrivers(pickupLat, pickupLng, 3);
    
    if (nearbyDrivers.length === 0) {
        return res.status(404).json({ error: 'No drivers available nearby' });
    }
    
    // Create ride in database (simplified - will add PostgreSQL later)
    const rideId = `ride_${Date.now()}_${riderId}`;
    
    // Store ride request in Redis with 60s expiry
    await redis.hset(`ride:${rideId}`, {
        riderId,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        status: 'searching',
        requestedAt: Date.now(),
        driversNotified: JSON.stringify(nearbyDrivers),
    });
    await redis.expire(`ride:${rideId}`, 60);
    
    // Publish to drivers via Redis Pub/Sub
    await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_REQUEST, {
        rideId,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        targetDrivers: nearbyDrivers, // Specific drivers or broadcast to all
    });
    
    res.json({
        rideId,
        status: 'searching',
        nearbyDriversCount: nearbyDrivers.length,
        message: 'Searching for drivers...',
    });
});

// Get ride status
app.get('/api/rides/:rideId/status', async (req: Request, res: Response) => {
    const { rideId } = req.params;
    
    const rideData = await redis.hgetall(`ride:${rideId}`);
    if (!rideData || Object.keys(rideData).length === 0) {
        return res.status(404).json({ error: 'Ride not found' });
    }
    
    res.json({
        rideId,
        status: rideData.status,
        driverId: rideData.driverId || null,
        acceptedAt: rideData.acceptedAt || null,
    });
});


// Driver accepts a ride
app.post('/api/rides/:rideId/accept', async (req: Request, res: Response) => {
    const { rideId } = req.params;
    const { driverId } = req.body;
    
    if (!driverId) {
        return res.status(400).json({ error: 'Driver ID required' });
    }
    
    // Use Redis transaction to prevent double booking
    const multi = redis.multi();
    multi.hget(`ride:${rideId}`, 'status');
    multi.hset(`ride:${rideId}`, {
        status: 'accepted',
        driverId,
        acceptedAt: Date.now(),
    });
    
    const results = await multi.exec();
    const currentStatus = results?.[0]?.[1] as string;
    
    if (currentStatus !== 'searching') {
        return res.status(409).json({ error: 'Ride already accepted or cancelled' });
    }
    
    // Remove driver from available pool
    await GeoOperations.removeDriverLocation(driverId);
    
    // Notify everyone via Pub/Sub
    await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_ACCEPTED, {
        rideId,
        driverId,
        status: 'accepted',
    });
    
    res.json({ success: true, rideId, status: 'accepted' });
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: [
            "http://127.0.0.1:5500",
            "http://localhost:5500"
        ],
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    socket.on('auth', (data) => {
        console.log('Authenticated:', data);
    });

    socket.on('driver:location', (data) => {
        console.log(' Driver location:', data);
    });

    socket.on('driver:accept_ride', (data) => {
        console.log('✅ Ride accepted:', data);
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`API + Socket Server running on http://localhost:${PORT}`);
});