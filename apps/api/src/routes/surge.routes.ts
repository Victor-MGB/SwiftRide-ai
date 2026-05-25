import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { ZoneManager } from '../../../../packages/zones/zone.manager';
import { SupplyDemandTracker } from '../../../../packages/zones/supply-demand.tracker';
import { redis } from '../../../../packages/redis/client';

const router = Router();

// Get surge multiplier for current location
router.get('/multiplier', authenticate, async (req: Request, res: Response) => {
    try {
        const { lat, lng } = req.query;
        
        if (!lat || !lng) {
            res.status(400).json({ error: 'Latitude and longitude required' });
            return;
        }
        
        const multiplier = await ZoneManager.getSurgeMultiplier(
            parseFloat(lat as string),
            parseFloat(lng as string)
        );
        
        const zone = await ZoneManager.getZoneForLocation(
            parseFloat(lat as string),
            parseFloat(lng as string)
        );
        
        res.json({
            multiplier,
            zone: zone ? {
                id: zone.id,
                name: zone.name,
                ratio: zone.ratio,
                activeRiders: zone.activeRiders,
                availableDrivers: zone.availableDrivers
            } : null,
            timestamp: Date.now()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get all zones with current surge (rider view)
router.get('/zones', authenticate, async (req: Request, res: Response) => {
    try {
        const zones = await ZoneManager.getAllZones();
        
        // Filter and format for riders
        const riderZones = zones.map(zone => ({
            id: zone.id,
            name: zone.name,
            multiplier: zone.multiplier,
            ratio: zone.ratio,
            center: zone.center
        }));
        
        res.json({
            zones: riderZones,
            lastUpdated: Date.now()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Add to surge.routes.ts temporarily for testing
router.post('/admin/init-zones', async (req, res) => {
    await ZoneManager.initializeZones();
    res.json({ message: 'Zones initialized' });
});

// Get surge heatmap data (for map visualization)
router.get('/heatmap', authenticate, async (req: Request, res: Response) => {
    try {
        const zones = await ZoneManager.getAllZones();
        
        const heatmapData = zones.map(zone => ({
            lat: zone.center.lat,
            lng: zone.center.lng,
            multiplier: zone.multiplier,
            intensity: (zone.multiplier - 1) / 4, // Normalize 0-1
            color: getSurgeColor(zone.multiplier)
        }));
        
        res.json({
            data: heatmapData,
            timestamp: Date.now()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Get detailed zone analytics
router.get('/admin/analytics', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
    try {
        const zones = await ZoneManager.getAllZones();
        
        const analytics = {
            zones: zones.map(zone => ({
                ...zone,
                surgeLevel: getSurgeLevel(zone.multiplier),
                supplyDemandRatio: zone.ratio.toFixed(2),
                timestamp: zone.lastUpdated
            })),
            summary: {
                totalZones: zones.length,
                averageSurge: zones.reduce((sum, z) => sum + z.multiplier, 0) / zones.length,
                maxSurge: Math.max(...zones.map(z => z.multiplier)),
                zonesWithSurge: zones.filter(z => z.multiplier > 1).length,
                peakSurgeZone: zones.reduce((max, z) => z.multiplier > max.multiplier ? z : max, zones[0])
            }
        };
        
        res.json(analytics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Manual override surge multiplier
router.post('/admin/manual-override', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
    try {
        const { zoneId, multiplier } = req.body;
        
        if (!zoneId || !multiplier) {
            res.status(400).json({ error: 'Zone ID and multiplier required' });
            return;
        }
        
        if (multiplier < 1 || multiplier > 5) {
            res.status(400).json({ error: 'Multiplier must be between 1 and 5' });
            return;
        }
        
        const success = await ZoneManager.manualSetSurge(zoneId, multiplier);
        
        if (!success) {
            res.status(404).json({ error: 'Zone not found' });
            return;
        }
        
        // Log admin action
        await redis.xadd('stream:admin:actions', '*',
            'adminId', req.user!.userId,
            'action', 'manual_surge_override',
            'zoneId', zoneId,
            'multiplier', multiplier.toString(),
            'timestamp', Date.now().toString()
        );
        
        res.json({
            success: true,
            zoneId,
            multiplier,
            message: `Surge multiplier for zone ${zoneId} set to ${multiplier}x`
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Reset surge for all zones (remove manual overrides)
router.post('/admin/reset-all', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
    try {
        const zones = await ZoneManager.getAllZones();
        
        for (const zone of zones) {
            await redis.hdel(`zone:${zone.id}`, 'manuallyOverridden', 'overriddenAt');
            await ZoneManager.updateZoneSupplyDemand(zone.id, 0, 0);
        }
        
        res.json({
            success: true,
            message: `Reset surge for ${zones.length} zones`
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get surge history for a zone (last 24 hours)
router.get('/history/:zoneId', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
    try {
        const { zoneId } = req.params;
        const { hours = 24 } = req.query;
        
        // Get historical data from Redis streams or PostgreSQL
        const history = await getSurgeHistory(zoneId, parseInt(hours as string));
        
        res.json({
            zoneId,
            history,
            hours
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Helper functions
function getSurgeColor(multiplier: number): string {
    if (multiplier <= 1.2) return '#10B981'; // Green
    if (multiplier <= 1.5) return '#F59E0B'; // Yellow
    if (multiplier <= 2.0) return '#F97316'; // Orange
    if (multiplier <= 3.0) return '#EF4444'; // Red
    return '#991B1B'; // Dark Red
}

function getSurgeLevel(multiplier: number): string {
    if (multiplier <= 1.0) return 'Normal';
    if (multiplier <= 1.3) return 'Low Surge';
    if (multiplier <= 1.7) return 'Medium Surge';
    if (multiplier <= 2.5) return 'High Surge';
    return 'Extreme Surge';
}

async function getSurgeHistory(zoneId: string, hours: number): Promise<any[]> {
    // Implementation to fetch from PostgreSQL
    // For now, return mock data
    const history = [];
    const now = Date.now();
    
    for (let i = hours; i >= 0; i--) {
        history.push({
            timestamp: now - (i * 3600000),
            multiplier: 1 + Math.random() * 2
        });
    }
    
    return history;
}

export default router;