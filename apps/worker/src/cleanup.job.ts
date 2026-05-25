import { DriverTrackingService } from '../../../packages/redis/driver-tracking';
import { redis } from '../../../packages/redis/client';

// Run cleanup every 30 seconds
async function cleanupInactiveDrivers() {
    const inactiveDrivers = await DriverTrackingService.cleanupInactiveDrivers();
    
    if (inactiveDrivers.length > 0) {
        console.log(`Cleaned up ${inactiveDrivers.length} inactive drivers:`, inactiveDrivers);
        
        // Log to monitoring system
        await redis.xadd('stream:monitoring:events', '*', 
            'type', 'driver_cleanup',
            'count', inactiveDrivers.length.toString(),
            'drivers', inactiveDrivers.join(','),
            'timestamp', Date.now().toString()
        );
    }
}

// Also clean up expired ride requests
async function cleanupExpiredRides() {
    const pattern = 'ride:*';
    const keys = await redis.keys(pattern);
    let cleaned = 0;
    
    for (const key of keys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1) {
            // No expiry set - set one
            await redis.expire(key, 3600);
        } else if (ttl === -2) {
            // Key doesn't exist
            continue;
        }
    }
    
    if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired ride sessions`);
    }
}

// Run cleanup every 30 seconds
setInterval(cleanupInactiveDrivers, 30000);
setInterval(cleanupExpiredRides, 60000);

console.log('Worker started - cleaning up inactive drivers every 30 seconds');