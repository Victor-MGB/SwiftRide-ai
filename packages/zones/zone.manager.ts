import { redis, REDIS_KEYS } from '../redis/client';
import { pool } from '../database/models';

export interface Zone {
    id: string;
    name: string;
    center: { lat: number; lng: number };
    bounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    };
    multiplier: number;
    activeRiders: number;
    availableDrivers: number;
    ratio: number;
    lastUpdated: Date;
}

export interface HexGridCell {
    id: string;
    lat: number;
    lng: number;
    radius: number; // in km
}

export class ZoneManager {
    private static readonly HEX_RADIUS_KM = 1; // 1km hex grid
    private static readonly UPDATE_INTERVAL = 60000; // 1 minute
    private static readonly SURGE_MIN = 1.0;
    private static readonly SURGE_MAX = 5.0;
    
    // Initialize zones (predefined city districts + hex grid)
    static async initializeZones(): Promise<void> {
        // Define city districts (custom zones)
        const districts = [
            { name: 'Downtown', center: { lat: 40.7128, lng: -74.0060 }, radius: 2 },
            { name: 'Times Square', center: { lat: 40.7580, lng: -73.9855 }, radius: 1.5 },
            { name: 'Financial District', center: { lat: 40.7075, lng: -74.0113 }, radius: 1.5 },
            { name: 'Upper East Side', center: { lat: 40.7730, lng: -73.9590 }, radius: 2 },
            { name: 'Upper West Side', center: { lat: 40.7870, lng: -73.9750 }, radius: 2 },
            { name: 'Brooklyn', center: { lat: 40.6782, lng: -73.9442 }, radius: 3 },
            { name: 'Queens', center: { lat: 40.7282, lng: -73.7949 }, radius: 3 },
            { name: 'Airport JFK', center: { lat: 40.6413, lng: -73.7781 }, radius: 2 }
        ];
        
        for (const district of districts) {
            const zoneId = `zone_${district.name.toLowerCase().replace(/\s+/g, '_')}`;
            
            await redis.hset(`zone:${zoneId}`, {
                id: zoneId,
                name: district.name,
                centerLat: district.center.lat.toString(),
                centerLng: district.center.lng.toString(),
                radius: district.radius.toString(),
                multiplier: '1.0',
                activeRiders: '0',
                availableDrivers: '0',
                ratio: '0'
            });
            
            await redis.expire(`zone:${zoneId}`, 3600);
        }
        
        // Generate hex grid for detailed surge mapping
        await this.generateHexGrid();
        
        console.log('Zones initialized successfully');
    }
    
    // Generate hex grid for entire city
    private static async generateHexGrid(): Promise<void> {
        const bounds = {
            north: 40.8000,
            south: 40.6000,
            east: -73.9000,
            west: -74.1000
        };
        
        const latStep = 0.009; // ~1km
        const lngStep = 0.012; // ~1km
        
        let gridId = 0;
        
        for (let lat = bounds.south; lat <= bounds.north; lat += latStep) {
            for (let lng = bounds.west; lng <= bounds.east; lng += lngStep) {
                const hexId = `hex_${gridId++}`;
                
                await redis.geoadd(
                    'hexgrid:zones',
                    lng,
                    lat,
                    hexId
                );
                
                await redis.hset(`hex:${hexId}`, {
                    id: hexId,
                    lat: lat.toString(),
                    lng: lng.toString(),
                    multiplier: '1.0'
                });
            }
        }
        
        console.log(`Generated ${gridId} hex grid cells`);
    }
    
    // Get zone for a given location
    static async getZoneForLocation(lat: number, lng: number): Promise<Zone | null> {
        // First check district zones
        const allZones = await redis.keys('zone:*');
        
        for (const zoneKey of allZones) {
            const zoneData = await redis.hgetall(zoneKey);
            if (!zoneData) continue;
            
            const centerLat = parseFloat(zoneData.centerLat);
            const centerLng = parseFloat(zoneData.centerLng);
            const radius = parseFloat(zoneData.radius);
            
            const distance = this.haversineDistance(lat, lng, centerLat, centerLng);
            
            if (distance <= radius) {
                return {
                    id: zoneData.id,
                    name: zoneData.name,
                    center: { lat: centerLat, lng: centerLng },
                    bounds: {
                        north: centerLat + radius / 111,
                        south: centerLat - radius / 111,
                        east: centerLng + radius / (111 * Math.cos(centerLat * Math.PI / 180)),
                        west: centerLng - radius / (111 * Math.cos(centerLat * Math.PI / 180))
                    },
                    multiplier: parseFloat(zoneData.multiplier),
                    activeRiders: parseInt(zoneData.activeRiders),
                    availableDrivers: parseInt(zoneData.availableDrivers),
                    ratio: parseFloat(zoneData.ratio),
                    lastUpdated: new Date(parseInt(zoneData.lastUpdated))
                };
            }
        }
        
        // Fallback to nearest hex grid cell
        const nearestHex = await redis.georadius(
            'hexgrid:zones',
            lng,
            lat,
            1,
            'km',
            'ASC',
            'LIMIT',
            0,
            1
        );
        
        if (nearestHex && nearestHex.length > 0) {
            const hexId = nearestHex[0] as string;
            const hexData = await redis.hgetall(`hex:${hexId}`);
            
            if (hexData) {
                return {
                    id: hexId,
                    name: `Zone ${hexId}`,
                    center: { lat: parseFloat(hexData.lat), lng: parseFloat(hexData.lng) },
                    bounds: {
                        north: parseFloat(hexData.lat) + 0.005,
                        south: parseFloat(hexData.lat) - 0.005,
                        east: parseFloat(hexData.lng) + 0.007,
                        west: parseFloat(hexData.lng) - 0.007
                    },
                    multiplier: parseFloat(hexData.multiplier || '1.0'),
                    activeRiders: parseInt(hexData.activeRiders || '0'),
                    availableDrivers: parseInt(hexData.availableDrivers || '0'),
                    ratio: parseFloat(hexData.ratio || '0'),
                    lastUpdated: new Date()
                };
            }
        }
        
        return null;
    }
    
    // Update supply/demand for a zone
    static async updateZoneSupplyDemand(
        zoneId: string,
        activeRidersDelta: number,
        availableDriversDelta: number
    ): Promise<void> {
        const multi = redis.multi();
        
        multi.hincrby(`zone:${zoneId}`, 'activeRiders', activeRidersDelta);
        multi.hincrby(`zone:${zoneId}`, 'availableDrivers', availableDriversDelta);
        
        await multi.exec();
        
        // Recalculate surge multiplier
        await this.recalculateZoneSurge(zoneId);
    }
    
    // Calculate surge multiplier based on ratio
    static calculateSurgeMultiplier(activeRiders: number, availableDrivers: number): number {
        if (availableDrivers === 0) return this.SURGE_MAX;
        
        const ratio = activeRiders / availableDrivers;
        
        // Formula: multiplier = max(1, min(5, ratio/2))
        let multiplier = ratio / 2;
        
        multiplier = Math.max(this.SURGE_MIN, Math.min(this.SURGE_MAX, multiplier));
        
        // Round to 1 decimal place
        return Math.round(multiplier * 10) / 10;
    }
    
    // Recalculate surge for a single zone
    private static async recalculateZoneSurge(zoneId: string): Promise<void> {
        const zoneData = await redis.hgetall(`zone:${zoneId}`);
        if (!zoneData) return;
        
        const activeRiders = parseInt(zoneData.activeRiders || '0');
        const availableDrivers = parseInt(zoneData.availableDrivers || '0');
        const ratio = availableDrivers > 0 ? activeRiders / availableDrivers : Infinity;
        const newMultiplier = this.calculateSurgeMultiplier(activeRiders, availableDrivers);
        const oldMultiplier = parseFloat(zoneData.multiplier || '1.0');
        
        await redis.hset(`zone:${zoneId}`, {
            multiplier: newMultiplier.toString(),
            ratio: ratio.toString(),
            lastUpdated: Date.now().toString()
        });
        
        // If multiplier changed significantly, broadcast update
        if (Math.abs(newMultiplier - oldMultiplier) >= 0.1) {
            await this.broadcastSurgeUpdate(zoneId, newMultiplier, oldMultiplier, ratio);
        }
    }
    
    // Broadcast surge update via Redis Pub/Sub
    private static async broadcastSurgeUpdate(
        zoneId: string,
        newMultiplier: number,
        oldMultiplier: number,
        ratio: number
    ): Promise<void> {
        const zoneData = await redis.hgetall(`zone:${zoneId}`);
        
        const update = {
            zoneId,
            zoneName: zoneData?.name || 'Unknown Zone',
            oldMultiplier,
            newMultiplier,
            ratio,
            activeRiders: parseInt(zoneData?.activeRiders || '0'),
            availableDrivers: parseInt(zoneData?.availableDrivers || '0'),
            timestamp: Date.now(),
            direction: newMultiplier > oldMultiplier ? 'up' : 'down'
        };
        
        await redis.publish(REDIS_KEYS.CHANNELS.SURGE_UPDATE, JSON.stringify(update));
        
        console.log(`Surge update for ${zoneData?.name}: ${oldMultiplier}x → ${newMultiplier}x (ratio: ${ratio.toFixed(2)})`);
    }
    
    // Get current surge multiplier for a location
    static async getSurgeMultiplier(lat: number, lng: number): Promise<number> {
        const zone = await this.getZoneForLocation(lat, lng);
        return zone?.multiplier || 1.0;
    }
    
    // Get all zones with current surge
    static async getAllZones(): Promise<Zone[]> {
        const zoneKeys = await redis.keys('zone:*');
        const zones: Zone[] = [];
        
        for (const zoneKey of zoneKeys) {
            const data = await redis.hgetall(zoneKey);
            if (data) {
                zones.push({
                    id: data.id,
                    name: data.name,
                    center: { lat: parseFloat(data.centerLat), lng: parseFloat(data.centerLng) },
                    bounds: {
                        north: parseFloat(data.centerLat) + parseFloat(data.radius) / 111,
                        south: parseFloat(data.centerLat) - parseFloat(data.radius) / 111,
                        east: parseFloat(data.centerLng) + parseFloat(data.radius) / (111 * Math.cos(parseFloat(data.centerLat) * Math.PI / 180)),
                        west: parseFloat(data.centerLng) - parseFloat(data.radius) / (111 * Math.cos(parseFloat(data.centerLat) * Math.PI / 180))
                    },
                    multiplier: parseFloat(data.multiplier),
                    activeRiders: parseInt(data.activeRiders),
                    availableDrivers: parseInt(data.availableDrivers),
                    ratio: parseFloat(data.ratio),
                    lastUpdated: new Date(parseInt(data.lastUpdated))
                });
            }
        }
        
        return zones.sort((a, b) => b.multiplier - a.multiplier);
    }
    
    // Manual override surge multiplier (admin)
    static async manualSetSurge(zoneId: string, multiplier: number): Promise<boolean> {
        if (multiplier < this.SURGE_MIN || multiplier > this.SURGE_MAX) {
            return false;
        }
        
        const zoneData = await redis.hgetall(`zone:${zoneId}`);
        if (!zoneData) return false;
        
        const oldMultiplier = parseFloat(zoneData.multiplier);
        
        await redis.hset(`zone:${zoneId}`, {
            multiplier: multiplier.toString(),
            manuallyOverridden: 'true',
            overriddenAt: Date.now().toString()
        });
        
        await this.broadcastSurgeUpdate(zoneId, multiplier, oldMultiplier, parseFloat(zoneData.ratio));
        
        return true;
    }
    
    private static haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371;
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    
    private static toRad(degrees: number): number {
        return degrees * (Math.PI / 180);
    }
}