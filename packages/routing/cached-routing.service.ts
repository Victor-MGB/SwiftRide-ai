import { redis } from '../redis/client';
import { osrmClient, RouteResponse } from './osrm.client';

export interface CachedRoute {
    distance: number;
    duration: number;
    geometry: string;
    cachedAt: number;
    expiresAt: number;
}

export class CachedRoutingService {
    private static readonly CACHE_TTL = 3600; // 1 hour cache
    private static readonly POPULAR_ROUTES_TTL = 86400; // 24 hours for popular routes
    
    // Get route with caching
    static async getRoute(
        origin: { lat: number; lng: number },
        destination: { lat: number; lng: number },
        useCache: boolean = true
    ): Promise<RouteResponse | null> {
        // Round coordinates to 4 decimal places (~11m precision) for better cache hits
        const cacheKey = this.generateCacheKey(origin, destination);
        
        if (useCache) {
            const cached = await this.getCachedRoute(cacheKey);
            if (cached) {
                console.log(`Cache hit for route: ${cacheKey}`);
                return {
                    distance: cached.distance,
                    duration: cached.duration,
                    geometry: cached.geometry,
                    legs: [] // Legs not cached, recalc if needed
                };
            }
        }
        
        // Fetch from OSRM
        const route = await osrmClient.getRoute(origin, destination);
        
        if (route) {
            await this.cacheRoute(cacheKey, route);
            
            // Track popularity for this route
            await this.incrementRoutePopularity(cacheKey);
        }
        
        return route;
    }
    
    // Get ETA with caching and real-time updates
    static async getETAWithCache(
        driverLocation: { lat: number; lng: number },
        pickupLocation: { lat: number; lng: number },
        driverId?: string
    ): Promise<{ etaSeconds: number; distance: number; route: RouteResponse | null }> {
        // Check for real-time traffic data (every 30 seconds for active rides)
        const isActiveRide = driverId !== undefined;
        
        if (isActiveRide) {
            // For active rides, get fresh route every 30 seconds
            const route = await osrmClient.getRoute(driverLocation, pickupLocation);
            if (route) {
                // Update cache in background
                const cacheKey = this.generateCacheKey(driverLocation, pickupLocation);
                this.cacheRoute(cacheKey, route).catch(console.error);
                
                return {
                    etaSeconds: route.duration,
                    distance: route.distance / 1000,
                    route
                };
            }
        }
        
        // Use cached route
        const route = await this.getRoute(driverLocation, pickupLocation);
        
        if (route) {
            return {
                etaSeconds: route.duration,
                distance: route.distance / 1000,
                route
            };
        }
        
        // Ultimate fallback
        const distance = this.haversineDistance(driverLocation, pickupLocation);
        return {
            etaSeconds: (distance / 30) * 3600,
            distance,
            route: null
        };
    }
    
    // Batch ETA for multiple drivers (finding best match)
    static async getBatchETAWithRanking(
        pickup: { lat: number; lng: number },
        drivers: Array<{ driverId: string; location: { lat: number; lng: number } }>
    ): Promise<Array<{ driverId: string; etaSeconds: number; distance: number; score: number }>> {
        const destinations = drivers.map(d => d.location);
        const etaResults = await osrmClient.getBatchETA(pickup, destinations);
        
        return drivers.map((driver, index) => ({
            driverId: driver.driverId,
            etaSeconds: etaResults[index].etaSeconds,
            distance: etaResults[index].distance,
            score: etaResults[index].etaSeconds * 0.7 + etaResults[index].distance * 30 // Weighted score
        })).sort((a, b) => a.score - b.score);
    }
    
    // Update ETA during active ride (every 30 seconds)
    static async updateLiveETA(
        rideId: string,
        driverLocation: { lat: number; lng: number }
    ): Promise<void> {
        const rideData = await redis.hgetall(`ride:${rideId}`);
        if (!rideData || rideData.status !== 'accepted') return;
        
        const pickupLat = parseFloat(rideData.pickupLat);
        const pickupLng = parseFloat(rideData.pickupLng);
        
        const eta = await this.getETAWithCache(
            driverLocation,
            { lat: pickupLat, lng: pickupLng },
            rideData.driverId
        );
        
        // Store updated ETA in Redis
        await redis.hset(`ride:${rideId}`, {
            currentETA: eta.etaSeconds.toString(),
            currentDistance: eta.distance.toString(),
            lastETAUpdate: Date.now().toString()
        });
        
        // Publish ETA update to rider
        await redis.publish('channel:ride:eta', JSON.stringify({
            rideId,
            etaSeconds: eta.etaSeconds,
            etaMinutes: Math.ceil(eta.etaSeconds / 60),
            distance: eta.distance,
            timestamp: Date.now()
        }));
    }
    
    // Pre-cache popular routes
    static async precachePopularRoutes(): Promise<void> {
        // Common routes in the city
        const popularRoutes = [
            { origin: { lat: 40.7128, lng: -74.0060 }, destination: { lat: 40.7580, lng: -73.9855 } }, // Downtown to Times Square
            { origin: { lat: 40.7580, lng: -73.9855 }, destination: { lat: 40.7128, lng: -74.0060 } }, // Times Square to Downtown
            { origin: { lat: 40.7489, lng: -73.9680 }, destination: { lat: 40.7851, lng: -73.9683 } }, // Empire State to Central Park
            // Add more popular routes based on historical data
        ];
        
        for (const route of popularRoutes) {
            await this.getRoute(route.origin, route.destination);
            // Small delay to not overload OSRM
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('Popular routes pre-cached');
    }
    
    // Helper: Generate cache key
    private static generateCacheKey(
        origin: { lat: number; lng: number },
        destination: { lat: number; lng: number }
    ): string {
        const round = (coord: number) => Math.round(coord * 10000) / 10000;
        return `route:${round(origin.lat)}:${round(origin.lng)}:${round(destination.lat)}:${round(destination.lng)}`;
    }
    
    // Helper: Get cached route
    private static async getCachedRoute(cacheKey: string): Promise<CachedRoute | null> {
        const cached = await redis.get(cacheKey);
        if (!cached) return null;
        
        const route: CachedRoute = JSON.parse(cached);
        if (route.expiresAt < Date.now()) {
            await redis.del(cacheKey);
            return null;
        }
        
        return route;
    }
    
    // Helper: Cache route
    private static async cacheRoute(cacheKey: string, route: RouteResponse): Promise<void> {
        const isPopular = await this.isPopularRoute(cacheKey);
        const ttl = isPopular ? this.POPULAR_ROUTES_TTL : this.CACHE_TTL;
        
        const cachedRoute: CachedRoute = {
            distance: route.distance,
            duration: route.duration,
            geometry: route.geometry,
            cachedAt: Date.now(),
            expiresAt: Date.now() + (ttl * 1000)
        };
        
        await redis.setex(cacheKey, ttl, JSON.stringify(cachedRoute));
    }
    
    // Track route popularity
    private static async incrementRoutePopularity(cacheKey: string): Promise<void> {
        const popularityKey = `route_popularity:${cacheKey}`;
        await redis.incr(popularityKey);
        await redis.expire(popularityKey, 7 * 86400); // 7 days
    }
    
    private static async isPopularRoute(cacheKey: string): Promise<boolean> {
        const popularityKey = `route_popularity:${cacheKey}`;
        const count = await redis.get(popularityKey);
        return parseInt(count || '0') > 10; // More than 10 requests = popular
    }
    
    private static haversineDistance(
        point1: { lat: number; lng: number },
        point2: { lat: number; lng: number }
    ): number {
        const R = 6371;
        const dLat = this.toRad(point2.lat - point1.lat);
        const dLon = this.toRad(point2.lng - point1.lng);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRad(point1.lat)) * Math.cos(this.toRad(point2.lat)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    
    private static toRad(degrees: number): number {
        return degrees * (Math.PI / 180);
    }
}