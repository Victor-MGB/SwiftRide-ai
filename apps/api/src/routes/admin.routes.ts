import { Router, Request, Response } from 'express';
import { UserService } from '../services/user.service';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/auth.middleware';
import { AuthService } from '../services/auth.service';
import { AdminMetricsService } from '../../../../packages/admin/metrics.service';
import { redis } from '../../../../packages/redis/client';
import { ZoneManager } from '../../../../packages/zones/zone.manager';

const router = Router();

// Create New Admin (Super Admin only)
router.post('/create-admin', async (req: Request, res: Response) => {
    try {
        const { email, phone, fullName, password } = req.body;

        if (!email || !phone || !fullName || !password) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        if (password.length < 8) {
            res.status(400).json({ error: 'Password must be at least 8 characters' });
            return;
        }

        const result = await AuthService.adminSignup({
            email,
            phone,
            fullName,
            password,
        });

        res.status(201).json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});


router.use(authenticate, requireRole('admin'));


// Get All Riders
router.get('/riders', async (req: Request, res: Response) => {
    try {
        const { page, limit, search, isActive } = req.query;

        const result = await UserService.getAllRiders({
            page: page ? parseInt(page as string) : undefined,
            limit: limit ? parseInt(limit as string) : undefined,
            search: search as string,
            isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        });

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get All Drivers
router.get('/drivers', async (req: Request, res: Response) => {
    try {
        const { page, limit, search, isActive, isApproved } = req.query;

        const result = await UserService.getAllDrivers({
            page: page ? parseInt(page as string) : undefined,
            limit: limit ? parseInt(limit as string) : undefined,
            search: search as string,
            isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
            isApproved: isApproved === 'true' ? true : isApproved === 'false' ? false : undefined,
        });

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/metrics/realtime', async(req:Request, res: Response) => {
    try{
        const metrics = await AdminMetricsService.getRealtimeMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({
            error: error.message
        })
    }
})

router.get('/metrics/historical', async(req: Request, res: Response) => {
    try{
        const { days = 7} = req.query;
        const metrics = await AdminMetricsService.getHistoricalMetrics(parseInt (days as string))
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({
            error: error.message
        });
    }
});

router.get('/metrics/performance', async (req: Request, res: Response) => {
    try {
        const metrics = await AdminMetricsService.getPerformanceMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// / Driver management
router.get('/drivers', async (req: Request, res: Response) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const drivers = await AdminMetricsService.getAllDrivers(
            parseInt(limit as string),
            parseInt(offset as string)
        );
        res.json(drivers);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/drivers/:driverId/deactivate', async (req: Request, res: Response) => {
    try {
        const { driverId } = req.params;
        const { reason } = req.body;
        const adminId = req.user!.userId;
        
        const success = await AdminMetricsService.deactivateDriver(driverId, adminId, reason);
        
        if (!success) {
            res.status(404).json({ error: 'Driver not found' });
            return;
        }
        
        res.json({ success: true, message: 'Driver deactivated successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/drivers/:driverId/approve', async (req: Request, res: Response) => {
    try {
        const { driverId } = req.params;
        const adminId = req.user!.userId;
        
        const success = await AdminMetricsService.approveDriver(driverId, adminId);
        
        if (!success) {
            res.status(404).json({ error: 'Driver not found' });
            return;
        }
        
        res.json({ success: true, message: 'Driver approved successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/rides', async (req: Request, res: Response) => {
    try {
        const { status, startDate, endDate, limit = 50, offset = 0 } = req.query;
        
        const result = await AdminMetricsService.getAllRides({
            status: status as string,
            startDate: startDate ? new Date(startDate as string) : undefined,
            endDate: endDate ? new Date(endDate as string) : undefined,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string)
        });
        
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/surge/zones', async (req: Request, res: Response) => {
    try {
        const zones = await ZoneManager.getAllZones();
        res.json(zones);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/surge/override', async (req: Request, res: Response) => {
    try {
        const { zoneId, multiplier } = req.body;
        
        if (!zoneId || !multiplier || multiplier < 1 || multiplier > 5) {
            res.status(400).json({ error: 'Invalid zone or multiplier' });
            return;
        }
        
        const success = await ZoneManager.manualSetSurge(zoneId, multiplier);
        
        if (!success) {
            res.status(404).json({ error: 'Zone not found' });
            return;
        }
        
        res.json({ success: true, message: `Surge multiplier for zone ${zoneId} set to ${multiplier}x` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// System controls
router.post('/system/clear-cache', async (req: Request, res: Response) => {
    try {
        // Clear route caches
        const routeKeys = await redis.keys('route:*');
        if (routeKeys.length > 0) {
            await redis.del(...routeKeys);
        }
        
        res.json({ success: true, message: `Cleared ${routeKeys.length} cache entries` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Export metrics for monitoring
router.get('/export/metrics', async (req: Request, res: Response) => {
    try {
        const realtime = await AdminMetricsService.getRealtimeMetrics();
        const historical = await AdminMetricsService.getHistoricalMetrics(30);
        
        res.json({
            exportedAt: new Date().toISOString(),
            realtime,
            historical,
            summary: {
                totalRidesLast30Days: historical.revenuePerDay.reduce((sum, d) => sum + d.amount, 0),
                averageSurgeMultiplier: realtime.surgeZones.reduce((sum, z) => sum + z.multiplier, 0) / (realtime.surgeZones.length || 1)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
export default router;