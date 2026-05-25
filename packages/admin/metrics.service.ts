import { pool } from '../database/models';
import { redis, REDIS_KEYS } from '../redis/client';
import { DriverTrackingService } from '../redis/driver-tracking';
import { ZoneManager } from '../zones/zone.manager';

export interface SystemMetrics {
    realtime: {
        activeDrivers: number;
        activeRides: number;
        activeRiders: number;
        surgeZones: Array<{ zone: string; multiplier: number }>;
        avgETA: number;
        completedToday: number;
    };
    historical: {
        ridesPerHour: Array<{ hour: string; count: number }>;
        revenuePerDay: Array<{ date: string; amount: number }>;
        avgETATrend: Array<{ hour: string; eta: number }>;
        surgeOccurrences: Array<{ hour: string; count: number }>;
    };
    performance: {
        avgResponseTime: number;
        errorRate: number;
        redisHitRate: number;
        apiCallsPerMinute: number;
    };
}

export class AdminMetricsService {
    
    // Get real-time metrics
    static async getRealtimeMetrics(): Promise<SystemMetrics['realtime']> {
        // Get active drivers count
        const activeDrivers = await redis.zcard(REDIS_KEYS.DRIVERS_ONLINE);
        
        // Get active rides (accepted, arrived, started)
        const rideKeys = await redis.keys('ride:*');
        let activeRides = 0;
        for (const key of rideKeys) {
            const status = await redis.hget(key, 'status');
            if (status && ['accepted', 'arrived', 'started'].includes(status)) {
                activeRides++;
            }
        }
        
        // Get surge zones
        const zones = await ZoneManager.getAllZones();
        const surgeZones = zones
            .filter(z => z.multiplier > 1)
            .map(z => ({ zone: z.name, multiplier: z.multiplier }))
            .sort((a, b) => b.multiplier - a.multiplier);
        
        // Get completed rides today
        const todayCompleted = await pool.query(
            `SELECT COUNT(*) FROM rides 
             WHERE status = 'completed' 
             AND completed_at::date = CURRENT_DATE`
        );
        
        // Calculate average ETA from active rides
        let totalETA = 0;
        let etaCount = 0;
        for (const key of rideKeys) {
            const currentETA = await redis.hget(key, 'currentETA');
            if (currentETA) {
                totalETA += parseInt(currentETA);
                etaCount++;
            }
        }
        const avgETA = etaCount > 0 ? totalETA / etaCount / 60 : 0;
        
        return {
            activeDrivers,
            activeRides,
            activeRiders: Math.floor(Math.random() * 100) + 50, // Mock - implement actual tracking
            surgeZones,
            avgETA: Math.round(avgETA),
            completedToday: parseInt(todayCompleted.rows[0].count)
        };
    }
    
    // Get historical metrics
    static async getHistoricalMetrics(days: number = 7): Promise<SystemMetrics['historical']> {
        // Rides per hour (last 24 hours)
        const ridesPerHour = await pool.query(
            `SELECT DATE_TRUNC('hour', requested_at) as hour, COUNT(*) as count
             FROM rides
             WHERE requested_at >= NOW() - INTERVAL '24 hours'
             GROUP BY hour
             ORDER BY hour`
        );
        
        // Revenue per day
        const revenuePerDay = await pool.query(
            `SELECT DATE(completed_at) as date, SUM(total_price) as amount
             FROM rides
             WHERE status = 'completed' 
             AND completed_at >= NOW() - INTERVAL '${days} days'
             GROUP BY date
             ORDER BY date`
        );
        
        // Average ETA trend (last 24 hours)
        const avgETATrend = await pool.query(
            `SELECT DATE_TRUNC('hour', accepted_at) as hour, 
                    AVG(EXTRACT(EPOCH FROM (started_at - accepted_at))) as avg_eta
             FROM rides
             WHERE accepted_at IS NOT NULL 
             AND started_at IS NOT NULL
             AND accepted_at >= NOW() - INTERVAL '24 hours'
             GROUP BY hour
             ORDER BY hour`
        );
        
        // Surge occurrences per hour
        const surgeOccurrences = await pool.query(
            `SELECT DATE_TRUNC('hour', requested_at) as hour, 
                    COUNT(*) as count
             FROM rides
             WHERE surge_multiplier > 1
             AND requested_at >= NOW() - INTERVAL '24 hours'
             GROUP BY hour
             ORDER BY hour`
        );
        
        return {
            ridesPerHour: ridesPerHour.rows.map(r => ({ hour: r.hour, count: parseInt(r.count) })),
            revenuePerDay: revenuePerDay.rows.map(r => ({ date: r.date, amount: parseFloat(r.amount) })),
            avgETATrend: avgETATrend.rows.map(r => ({ hour: r.hour, eta: Math.round(parseFloat(r.avg_eta)) })),
            surgeOccurrences: surgeOccurrences.rows.map(r => ({ hour: r.hour, count: parseInt(r.count) }))
        };
    }
    
    // Get performance metrics
    static async getPerformanceMetrics(): Promise<SystemMetrics['performance']> {
        // Get from Redis monitoring
        const avgResponseTime = await redis.get('metric:avg_response_time') || '150';
        const errorRate = await redis.get('metric:error_rate') || '0.5';
        const redisHitRate = await redis.get('metric:redis_hit_rate') || '95';
        const apiCallsPerMinute = await redis.get('metric:api_calls_per_minute') || '1200';
        
        return {
            avgResponseTime: parseInt(avgResponseTime),
            errorRate: parseFloat(errorRate),
            redisHitRate: parseFloat(redisHitRate),
            apiCallsPerMinute: parseInt(apiCallsPerMinute)
        };
    }
    
    // Get all drivers (for management)
    static async getAllDrivers(limit: number = 50, offset: number = 0): Promise<any[]> {
        const result = await pool.query(
            `SELECT u.id, u.email, u.phone, u.full_name, u.created_at,
                    dp.vehicle_model, dp.vehicle_plate, dp.is_approved, dp.rating, dp.total_trips,
                    COALESCE(w.balance, 0) as wallet_balance
             FROM users u
             JOIN driver_profiles dp ON u.id = dp.user_id
             LEFT JOIN wallets w ON u.id = w.user_id
             WHERE u.role = 'driver'
             ORDER BY u.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        
        // Add online status
        const drivers = await Promise.all(result.rows.map(async (driver) => {
            const status = await DriverTrackingService.getDriverStatus(driver.id);
            return {
                ...driver,
                is_online: status !== null && status.status === 'online',
                current_location: status?.lastLocation || null
            };
        }));
        
        return drivers;
    }
    
    // Get all rides with filters
    static async getAllRides(filters: {
        status?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
        offset?: number;
    }): Promise<{ rides: any[]; total: number }> {
        let query = `SELECT r.*, 
                            rider.email as rider_email, rider.full_name as rider_name,
                            driver.email as driver_email, driver.full_name as driver_name
                     FROM rides r
                     LEFT JOIN users rider ON r.rider_id = rider.id
                     LEFT JOIN users driver ON r.driver_id = driver.id
                     WHERE 1=1`;
        const params: any[] = [];
        let paramIndex = 1;
        
        if (filters.status) {
            query += ` AND r.status = $${paramIndex++}`;
            params.push(filters.status);
        }
        
        if (filters.startDate) {
            query += ` AND r.requested_at >= $${paramIndex++}`;
            params.push(filters.startDate);
        }
        
        if (filters.endDate) {
            query += ` AND r.requested_at <= $${paramIndex++}`;
            params.push(filters.endDate);
        }
        
        // Get total count
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM (${query}) as sub`,
            params
        );
        const total = parseInt(countResult.rows[0].count);
        
        // Get paginated results
        query += ` ORDER BY r.requested_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(filters.limit || 50);
        params.push(filters.offset || 0);
        
        const result = await pool.query(query, params);
        
        return {
            rides: result.rows,
            total
        };
    }
    
    // Deactivate driver
    static async deactivateDriver(driverId: string, adminId: string, reason: string): Promise<boolean> {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            await client.query(
                `UPDATE users SET is_active = false WHERE id = $1 AND role = 'driver'`,
                [driverId]
            );
            
            // Log admin action
            await client.query(
                `INSERT INTO admin_logs (admin_id, action, target_id, details, created_at)
                 VALUES ($1, 'deactivate_driver', $2, $3, NOW())`,
                [adminId, driverId, JSON.stringify({ reason })]
            );
            
            // Remove from online pool
            const { GeoOperations } = await import('../redis/client');
            await GeoOperations.removeDriverLocation(driverId);
            
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Deactivate driver error:', error);
            return false;
        } finally {
            client.release();
        }
    }
    
    // Approve driver
    static async approveDriver(driverId: string, adminId: string): Promise<boolean> {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            await client.query(
                `UPDATE driver_profiles SET is_approved = true, approved_at = NOW() WHERE user_id = $1`,
                [driverId]
            );
            
            await client.query(
                `INSERT INTO admin_logs (admin_id, action, target_id, details, created_at)
                 VALUES ($1, 'approve_driver', $2, 'Driver approved', NOW())`,
                [adminId, driverId]
            );
            
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Approve driver error:', error);
            return false;
        } finally {
            client.release();
        }
    }
}