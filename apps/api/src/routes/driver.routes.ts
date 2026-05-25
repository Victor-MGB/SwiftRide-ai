import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { DriverTrackingService, DriverStatus } from '../../../../packages/redis/driver-tracking';
import { redis, GeoOperations } from '../../../../packages/redis/client';

const router = Router();

router.get(
  '/nearby',
  authenticate,
  requireRole('rider'),
  async (req: Request, res: Response) => {
    try {
      const { lat, lng, radius = '5' } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          error: 'Latitude and longitude are required'
        });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lng as string);
      const searchRadius = parseFloat(radius as string);

      if (
        isNaN(latitude) ||
        isNaN(longitude) ||
        isNaN(searchRadius)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Invalid numeric values'
        });
      }

      if (
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180
      ) {
        return res.status(400).json({
          success: false,
          error: 'Invalid coordinate range'
        });
      }

      if (searchRadius <= 0 || searchRadius > 50) {
        return res.status(400).json({
          success: false,
          error: 'Radius must be between 1 and 50 km'
        });
      }

      const nearbyDriverIds = await GeoOperations.findNearbyDrivers(
        latitude,
        longitude,
        searchRadius
      );

      if (!nearbyDriverIds || nearbyDriverIds.length === 0) {
        return res.json({
          success: true,
          count: 0,
          drivers: [],
          message: 'No drivers found nearby',
          timestamp: Date.now()
        });
      }

      const driverDetails = await Promise.all(
        nearbyDriverIds.map(async (driverId: string) => {
          try {
            const info = await DriverTrackingService.getDriverStatus(driverId);

            // skip if no info or not online
            if (!info || info.status !== DriverStatus.ONLINE) {
              return null;
            }

            return {
              driverId,
              latitude: info.lastLocation?.lat,
              longitude: info.lastLocation?.lng,
              vehicleModel: info.vehicleModel || 'Unknown',
              rating: info.rating || 0,
              status: info.status
            };
          } catch (err) {
            console.error(`Error fetching driver ${driverId}:`, err);
            return null;
          }
        })
      );

      const validDrivers = driverDetails.filter(Boolean);

      return res.json({
        success: true,
        count: validDrivers.length,
        radius: searchRadius,
        drivers: validDrivers,
        timestamp: Date.now()
      });

    } catch (error: any) {
      console.error('Nearby drivers error:', error);

      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }
);

// All driver routes require authentication and driver role
router.use(authenticate, requireRole('driver'));

// Update driver location (called every 3-5 seconds)
router.post('/location/update', async (req: Request, res: Response) => {
    try {
        const driverId = req.user!.userId;
        const { latitude, longitude, status, rideId } = req.body;
        
        if (!latitude || !longitude || !status) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        
        // Validate coordinates
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            res.status(400).json({ error: 'Invalid coordinates' });
            return;
        }
        
        // Validate status
        if (!Object.values(DriverStatus).includes(status)) {
            res.status(400).json({ error: 'Invalid driver status' });
            return;
        }
        
        await DriverTrackingService.updateLocation(
            driverId,
            latitude,
            longitude,
            status,
            rideId
        );
        
        res.json({ 
            success: true, 
            timestamp: Date.now(),
            message: 'Location updated'
        });
    } catch (error: any) {
        console.error('Location update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get current driver status
router.get(
    '/status',
    authenticate, 
    async (req: Request, res: Response) => {
        try {
            const driverId = req.user!.userId;

            const status = await DriverTrackingService.getDriverStatus(driverId);

            if (!status) {
                return res.json({
                    success: true,
                    driverId,
                    status: DriverStatus.OFFLINE,
                    lastLocation: null
                });
            }

            return res.json({
                success: true,
                driverId,
                status: status.status,
                lastLocation: status.lastLocation,
                vehicleModel: status.vehicleModel,
                rating: status.rating
            });

        } catch (error: any) {
            console.error('STATUS ERROR:', error);

            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

router.post(
    '/status/set',
    authenticate, 
    async (req: Request, res: Response) => {
        try {
            const driverId = req.user!.userId;
            let { newStatus, latitude, longitude } = req.body;

            if (typeof newStatus === 'string') {
    newStatus = newStatus.trim().toLowerCase();
}

            if (!newStatus || !Object.values(DriverStatus).includes(newStatus)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status',
                    allowed: Object.values(DriverStatus)
                });
            }

            await DriverTrackingService.setDriverStatus(driverId, newStatus);

            //  optional location update when going online
            if (newStatus === DriverStatus.ONLINE && latitude && longitude) {

                const lat = parseFloat(latitude);
                const lng = parseFloat(longitude);

                if (
                    !isNaN(lat) &&
                    !isNaN(lng) &&
                    lat >= -90 && lat <= 90 &&
                    lng >= -180 && lng <= 180
                ) {
                    await DriverTrackingService.updateLocation(
                        driverId,
                        lat,
                        lng,
                        DriverStatus.ONLINE
                    );
                }
            }

            return res.json({
                success: true,
                driverId,
                status: newStatus,
                message: `Driver set to ${newStatus}`
            });

        } catch (error: any) {
            console.error('STATUS SET ERROR:', error);

            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

router.get(
    '/rides/history',
    authenticate,
    requireRole('driver'),
    async (req: Request, res: Response) => {
        try {
            const driverId = req.user!.userId;

            const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
            const offset = parseInt(req.query.offset as string) || 0;

            const { pool } = await import('../../../../packages/database/models');

            const result = await pool.query(
                `SELECT id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
                        total_price, status, requested_at, completed_at
                 FROM rides 
                 WHERE driver_id = $1 
                 ORDER BY requested_at DESC 
                 LIMIT $2 OFFSET $3`,
                [driverId, limit, offset]
            );

            const countResult = await pool.query(
                `SELECT COUNT(*) FROM rides WHERE driver_id = $1`,
                [driverId]
            );

            return res.json({
                success: true,
                rides: result.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    limit,
                    offset
                }
            });

        } catch (error: any) {
            console.error('RIDES HISTORY ERROR:', error);

            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

export default router;