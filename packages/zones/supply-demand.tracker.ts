import { redis } from '../redis/client';
import { ZoneManager } from './zone.manager';
import { DriverTrackingService, DriverStatus } from '../redis/driver-tracking';

export class SupplyDemandTracker {
    private static trackingInterval: NodeJS.Timeout | null = null;
    
    // Start tracking supply and demand
    static async startTracking(): Promise<void> {
        console.log('Supply/Demand Tracker started');
        
        // Run every minute
        this.trackingInterval = setInterval(async () => {
            await this.updateAllZones();
        }, 60000);
        
        // Initial update
        await this.updateAllZones();
    }
    
    // Update all zones with current supply/demand
    private static async updateAllZones(): Promise<void> {
        try {
            const zones = await ZoneManager.getAllZones();
            
            for (const zone of zones) {
                await this.updateZoneMetrics(zone);
            }
            
            console.log(`Updated surge for ${zones.length} zones`);
        } catch (error) {
            console.error('Zone update error:', error);
        }
    }
    
    // Update metrics for a single zone
    private static async updateZoneMetrics(zone: any): Promise<void> {
        // Count active riders in this zone (riders with pending ride requests)
        const activeRiders = await this.countActiveRidersInZone(zone);
        
        // Count available drivers in this zone
        const availableDrivers = await this.countAvailableDriversInZone(zone);
        
        // Update Redis
        await redis.hset(`zone:${zone.id}`, {
            activeRiders: activeRiders.toString(),
            availableDrivers: availableDrivers.toString(),
            lastComputed: Date.now().toString()
        });
        
        // Recalculate surge
        await ZoneManager.updateZoneSupplyDemand(zone.id, 0, 0);
    }
    
    // Count riders with active requests in zone
    private static async countActiveRidersInZone(zone: any): Promise<number> {
        // Get all rides with status 'searching'
        const rideKeys = await redis.keys('ride:*');
        let count = 0;
        
        for (const rideKey of rideKeys) {
            const rideData = await redis.hgetall(rideKey);
            if (rideData && rideData.status === 'searching') {
                const pickupLat = parseFloat(rideData.pickupLat);
                const pickupLng = parseFloat(rideData.pickupLng);
                
                // Check if pickup is within zone
                if (this.isPointInZone(pickupLat, pickupLng, zone)) {
                    count++;
                }
            }
        }
        
        return count;
    }
    
    // Count available drivers in zone
    private static async countAvailableDriversInZone(zone: any): Promise<number> {
        // Get all online drivers from Redis GEO
        const drivers = await redis.zrange('drivers:online', 0, -1);
        let count = 0;
        
        for (const driverId of drivers) {
            const driverStatus = await DriverTrackingService.getDriverStatus(driverId);
            
            if (driverStatus && driverStatus.status === DriverStatus.ONLINE) {
                // Check if driver location is within zone
                if (this.isPointInZone(driverStatus.lastLocation.lat, driverStatus.lastLocation.lng, zone)) {
                    count++;
                }
            }
        }
        
        return count;
    }
    
    // Check if point is within zone bounds
    private static isPointInZone(lat: number, lng: number, zone: any): boolean {
        return lat >= zone.bounds.south &&
               lat <= zone.bounds.north &&
               lng >= zone.bounds.west &&
               lng <= zone.bounds.east;
    }
    
    // Record a ride request (increment demand)
    static async recordRideRequest(lat: number, lng: number): Promise<void> {
        const zone = await ZoneManager.getZoneForLocation(lat, lng);
        if (zone) {
            await ZoneManager.updateZoneSupplyDemand(zone.id, 1, 0);
        }
    }
    
    // Record a driver going online (increment supply)
    static async recordDriverOnline(lat: number, lng: number): Promise<void> {
        const zone = await ZoneManager.getZoneForLocation(lat, lng);
        if (zone) {
            await ZoneManager.updateZoneSupplyDemand(zone.id, 0, 1);
        }
    }
    
    // Record a driver going offline (decrement supply)
    static async recordDriverOffline(lat: number, lng: number): Promise<void> {
        const zone = await ZoneManager.getZoneForLocation(lat, lng);
        if (zone) {
            await ZoneManager.updateZoneSupplyDemand(zone.id, 0, -1);
        }
    }
    
    // Record ride completion (decrement demand)
    static async recordRideCompletion(lat: number, lng: number): Promise<void> {
        const zone = await ZoneManager.getZoneForLocation(lat, lng);
        if (zone) {
            await ZoneManager.updateZoneSupplyDemand(zone.id, -1, 0);
        }
    }
    
    // Stop tracking
    static stopTracking(): void {
        if (this.trackingInterval) {
            clearInterval(this.trackingInterval);
            this.trackingInterval = null;
        }
    }
}