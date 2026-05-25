import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { CachedRoutingService } from '../../../../packages/routing/cached-routing.service';
import { DriverTrackingService } from '../../../../packages/redis/driver-tracking';

const router = Router();

// Get ETA for a ride
router.get('/eta/:rideId', authenticate, async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const userId = req.user!.userId;
        
        // Get ride data
        const { redis } = await import('../../../../packages/redis/client');
        const rideData = await redis.hgetall(`ride:${rideId}`);
        
        if (!rideData || Object.keys(rideData).length === 0) {
            res.status(404).json({ error: 'Ride not found' });
            return;
        }
        
        // Check authorization
        if (rideData.riderId !== userId && rideData.driverId !== userId && req.user!.role !== 'admin') {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }
        
        // Get driver location
        const driverStatus = await DriverTrackingService.getDriverStatus(rideData.driverId);
        if (!driverStatus) {
            res.status(404).json({ error: 'Driver location not found' });
            return;
        }
        
        const pickupLocation = {
            lat: parseFloat(rideData.pickupLat),
            lng: parseFloat(rideData.pickupLng)
        };
        
        // Calculate ETA
        const eta = await CachedRoutingService.getETAWithCache(
            driverStatus.lastLocation,
            pickupLocation,
            rideData.driverId
        );
        
        res.json({
            etaSeconds: eta.etaSeconds,
            etaMinutes: Math.ceil(eta.etaSeconds / 60),
            distance: eta.distance,
            routeGeometry: eta.route?.geometry || null,
            timestamp: Date.now()
        });
    } catch (error: any) {
        console.error('ETA calculation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get route between two points
router.post('/route', authenticate, async (req: Request, res: Response) => {
    try {
        const { origin, destination } = req.body;
        
        if (!origin || !destination) {
            res.status(400).json({ error: 'Origin and destination required' });
            return;
        }
        
        const route = await CachedRoutingService.getRoute(origin, destination);
        
        if (!route) {
            res.status(500).json({ error: 'Failed to calculate route' });
            return;
        }
        
        res.json({
            distance: route.distance / 1000, // km
            duration: route.duration, // seconds
            durationMinutes: Math.ceil(route.duration / 60),
            geometry: route.geometry,
            steps: route.legs[0]?.steps || []
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Batch ETA for multiple drivers (used by matching algorithm)
router.post('/batch-eta', authenticate, requireRole('rider'), async (req: Request, res: Response) => {
    try {
        const { pickup, drivers } = req.body;
        
        if (!pickup || !drivers || !Array.isArray(drivers)) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }
        
        const rankedDrivers = await CachedRoutingService.getBatchETAWithRanking(pickup, drivers);
        
        res.json({
            drivers: rankedDrivers,
            timestamp: Date.now()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Pre-cache popular routes (admin only)
router.post('/precache', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
    try {
        await CachedRoutingService.precachePopularRoutes();
        res.json({ message: 'Popular routes pre-cached successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;