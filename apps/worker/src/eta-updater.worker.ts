import { redis } from '../../../packages/redis/client';
import { CachedRoutingService } from '../../../packages/routing/cached-routing.service';
import { DriverTrackingService } from '../../../packages/redis/driver-tracking';

class ETAUpdaterWorker {
    private isRunning = true;
    
    async start(): Promise<void> {
        console.log('ETA Updater Worker started');
        
        while (this.isRunning) {
            try {
                await this.updateActiveRidesETA();
                await new Promise(resolve => setTimeout(resolve, 30000)); // Run every 30 seconds
            } catch (error) {
                console.error('ETA updater error:', error);
            }
        }
    }
    
    private async updateActiveRidesETA(): Promise<void> {
        // Find all active rides (accepted or arrived status)
        const rideKeys = await redis.keys('ride:*');
        
        for (const rideKey of rideKeys) {
            const rideData = await redis.hgetall(rideKey);
            
            // Only update rides that are accepted (driver en route)
            if (rideData.status !== 'accepted' && rideData.status !== 'arrived') {
                continue;
            }
            
            const driverStatus = await DriverTrackingService.getDriverStatus(rideData.driverId);
            
            if (!driverStatus || !driverStatus.lastLocation) {
                continue;
            }
            
            // Update ETA
            console.log(`Updating ETA for ride ${rideData.rideId}`);
            await CachedRoutingService.updateLiveETA(
                rideData.rideId,
                driverStatus.lastLocation
            );
        }
    }
    
    stop(): void {
        this.isRunning = false;
        console.log('ETA Updater Worker stopped');
    }
}

const worker = new ETAUpdaterWorker();
worker.start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, stopping worker...');
    worker.stop();
    process.exit(0);
});