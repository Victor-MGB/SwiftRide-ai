import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { RideMatchingService } from '../../../../packages/ride-matching/matching.service';
import { PubSub, REDIS_KEYS } from '../../../../packages/redis/client';

const router = Router();

// Driver arrived at pickup
router.post('/:rideId/arrived', authenticate, requireRole('driver'), async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const driverId = req.user!.userId;

        const success = await RideMatchingService.markDriverArrived(rideId, driverId);
        
        if (!success) {
            return res.status(400).json({ success: false, error: 'Cannot mark as arrived' });
        }

        res.json({ success: true, message: 'Driver arrived at pickup' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start ride
router.post('/:rideId/start', authenticate, requireRole('driver'), async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const driverId = req.user!.userId;

        const success = await RideMatchingService.startRide(rideId, driverId);
        
        if (!success) {
            return res.status(400).json({ success: false, error: 'Cannot start ride' });
        }

        res.json({ success: true, message: 'Ride started successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Complete ride
router.post('/:rideId/complete', authenticate, requireRole('driver'), async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const driverId = req.user!.userId;
        const { finalPrice } = req.body;

        const success = await RideMatchingService.completeRide(rideId, driverId, finalPrice);
        
        if (!success) {
            return res.status(400).json({ success: false, error: 'Cannot complete ride' });
        }

        res.json({ success: true, message: 'Ride completed successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Driver reject ride
router.post('/:rideId/reject', authenticate, requireRole('driver'), async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const driverId = req.user!.userId;
        const { reason } = req.body;

        const success = await RideMatchingService.rejectRide(rideId, driverId, reason);
        
        if (!success) {
            return res.status(400).json({ success: false, error: 'Cannot reject ride' });
        }

        res.json({ success: true, message: 'Ride rejected' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get active ride
router.get('/active', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;

        const activeRide = await RideMatchingService.getActiveRide(userId);

        if (!activeRide) {
            return res.json({ success: true, activeRide: null });
        }

        res.json({ success: true, activeRide });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Submit rating
router.post('/:rideId/rate', authenticate, async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const userId = req.user!.userId;
        const { rating, comment } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
        }

        const success = await RideMatchingService.submitRating(rideId, userId, rating, comment);

        if (!success) {
            return res.status(400).json({ success: false, error: 'Cannot submit rating' });
        }

        res.json({ success: true, message: 'Rating submitted successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Request a ride (Rider)
router.post('/request', authenticate, requireRole('rider'), async (req: Request, res: Response) => {
    try {
        const riderId = req.user!.userId;
        const { pickupLat, pickupLng, dropoffLat, dropoffLng, rideType } = req.body;
        
        // Validation
        const required = ['pickupLat','pickupLng','dropoffLat','dropoffLng'];

for (const key of required) {
    if (req.body[key] == null) {
        return res.status(400).json({
            error: `${key} is required`
        });
    }
}
        
        // Validate coordinates
        if (Math.abs(pickupLat) > 90 || Math.abs(pickupLng) > 180) {
            res.status(400).json({ error: 'Invalid coordinates' });
            return;
        }
        
        // Check if rider already has an active ride
        const activeRide = await checkActiveRide(riderId);
        if (activeRide) {
            res.status(409).json({ error: 'You already have an active ride' });
            return;
        }
        
        const result = await RideMatchingService.requestRide({
            riderId,
            pickupLat,
            pickupLng,
            dropoffLat,
            dropoffLng,
            rideType
        });
        
        res.status(201).json(result);
    } catch (error: any) {
        console.error('Ride request error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get ride status
router.get('/:rideId/status', authenticate, async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const userId = req.user!.userId;
        
        const rideStatus = await RideMatchingService.getRideStatus(rideId);
        
        if (!rideStatus) {
            res.status(404).json({ error: 'Ride not found' });
            return;
        }
        
        // Check authorization (rider or assigned driver or admin)
        if (rideStatus.riderId !== userId && 
            rideStatus.driverId !== userId && 
            req.user!.role !== 'admin') {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }
        
        res.json(rideStatus);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Cancel ride
router.post('/:rideId/cancel', authenticate, requireRole('rider'), async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const riderId = req.user!.userId;
        const { reason = 'User cancelled' } = req.body;
        
        const cancelled = await RideMatchingService.cancelRide(rideId, riderId, reason);
        
        if (!cancelled) {
            res.status(404).json({ error: 'Ride not found or already completed' });
            return;
        }
        
        res.json({ success: true, message: 'Ride cancelled' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get nearby drivers (for rider before requesting)
router.get('/nearby-drivers', authenticate, requireRole('rider'), async (req: Request, res: Response) => {
    try {
        const { lat, lng, radius = 5 } = req.query;
        
        if (!lat || !lng) {
            res.status(400).json({ error: 'Latitude and longitude required' });
            return;
        }
        
        const drivers = await RideMatchingService.findNearbyDrivers(
            parseFloat(lat as string),
            parseFloat(lng as string),
            parseFloat(radius as string),
            10
        );
        
        res.json({
            count: drivers.length,
            drivers,
            timestamp: Date.now()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Driver accept ride
router.post('/:rideId/accept', authenticate, requireRole('driver'), async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const driverId = req.user!.userId;
        
        const rideData = await RideMatchingService.getRideStatus(rideId);
        
        if (!rideData) {
            res.status(404).json({ error: 'Ride not found' });
            return;
        }
        
        if (rideData.status !== 'searching') {
            res.status(409).json({ error: 'Ride no longer available' });
            return;
        }
        
        const assigned = await RideMatchingService.assignDriverToRide(rideId, driverId);
        
        if (!assigned) {
            res.status(409).json({ error: 'Failed to accept ride - already taken' });
            return;
        }
        
        // Import driver tracking dynamically to avoid circular dependency
        const { DriverTrackingService, DriverStatus } = await import('../../../../packages/redis/driver-tracking');
        await DriverTrackingService.setDriverStatus(driverId, DriverStatus.ON_RIDE, rideId);
        
        // Notify rider via WebSocket
        await PubSub.publish(REDIS_KEYS.CHANNELS.RIDE_ACCEPTED, {
            rideId,
            driverId,
            status: 'accepted',
            eta: rideData.estimatedDistance ? Math.ceil(rideData.estimatedDistance / 30 * 60) : 5
        });
        
        res.json({ 
            success: true, 
            rideId, 
            status: 'accepted',
            message: 'Ride accepted successfully'
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Helper: Check if rider has active ride
async function checkActiveRide(riderId: string): Promise<boolean> {
    const { pool } = await import('../../../../packages/database/models');
    const result = await pool.query(
        `SELECT id FROM rides 
         WHERE rider_id = $1 
         AND status IN ('searching', 'accepted', 'arrived', 'started')
         LIMIT 1`,
        [riderId]
    );
    return result.rows.length > 0;
}

export default router;