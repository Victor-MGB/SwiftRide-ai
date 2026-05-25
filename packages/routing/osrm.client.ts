import axios from 'axios';

export interface RouteResponse {
    distance: number; // in meters
    duration: number; // in seconds
    geometry: string; // encoded polyline
    legs: Array<{
        distance: number;
        duration: number;
        steps: Array<{
            distance: number;
            duration: number;
            instruction: string;
            name: string;
        }>;
    }>;
}

export interface ETARequest {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    currentLocation?: { lat: number; lng: number };
    traffic?: boolean;
}

export class OSRMClient {
    private baseUrl: string;
    
    constructor(baseUrl: string = 'http://localhost:5000') {
        this.baseUrl = baseUrl;
    }
    
    // Get route between two points
    async getRoute(
        origin: { lat: number; lng: number },
        destination: { lat: number; lng: number }
    ): Promise<RouteResponse | null> {
        try {
            const url = `${this.baseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
            const response = await axios.get(url, {
                params: {
                    overview: 'full',
                    geometries: 'polyline',
                    steps: 'true',
                    alternatives: 'false'
                }
            });
            
            if (response.data.code !== 'Ok') {
                console.error('OSRM error:', response.data);
                return null;
            }
            
            const route = response.data.routes[0];
            return {
                distance: route.distance,
                duration: route.duration,
                geometry: route.geometry,
                legs: route.legs.map((leg: any) => ({
                    distance: leg.distance,
                    duration: leg.duration,
                    steps: leg.steps.map((step: any) => ({
                        distance: step.distance,
                        duration: step.duration,
                        instruction: step.instruction,
                        name: step.name
                    }))
                }))
            };
        } catch (error) {
            console.error('Route fetch error:', error);
            return null;
        }
    }
    
    // Get ETA from driver to rider
    async getDriverETA(
        driverLocation: { lat: number; lng: number },
        pickupLocation: { lat: number; lng: number }
    ): Promise<{ etaSeconds: number; distance: number; route: RouteResponse | null }> {
        const route = await this.getRoute(driverLocation, pickupLocation);
        
        if (!route) {
            // Fallback to straight-line distance calculation
            const distance = this.haversineDistance(driverLocation, pickupLocation);
            const etaSeconds = (distance / 30) * 3600; // Assume 30 km/h average
            return { etaSeconds, distance, route: null };
        }
        
        return {
            etaSeconds: route.duration,
            distance: route.distance / 1000, // Convert to km
            route
        };
    }
    
    // Batch route calculation (for multiple drivers)
    async getBatchETA(
        origin: { lat: number; lng: number },
        destinations: Array<{ lat: number; lng: number }>
    ): Promise<Array<{ etaSeconds: number; distance: number }>> {
        try {
            // Build coordinates string: origin;dest1;dest2;...
            const coords = `${origin.lng},${origin.lat};${destinations.map(d => `${d.lng},${d.lat}`).join(';')}`;
            const url = `${this.baseUrl}/table/v1/driving/${coords}`;
            
            const response = await axios.get(url, {
                params: {
                    sources: 0, // First coordinate is source
                    destinations: Array.from({ length: destinations.length }, (_, i) => i + 1).join(';')
                }
            });
            
            if (response.data.code !== 'Ok') {
                throw new Error('Batch table request failed');
            }
            
            return response.data.durations[0].map((duration: number, index: number) => ({
                etaSeconds: duration,
                distance: (response.data.distances[0][index] || 0) / 1000
            }));
        } catch (error) {
            console.error('Batch ETA error:', error);
            // Fallback to haversine
            return destinations.map(dest => {
                const distance = this.haversineDistance(origin, dest);
                return {
                    etaSeconds: (distance / 30) * 3600,
                    distance
                };
            });
        }
    }
    
    // Haversine distance as fallback
    private haversineDistance(
        point1: { lat: number; lng: number },
        point2: { lat: number; lng: number }
    ): number {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(point2.lat - point1.lat);
        const dLon = this.toRad(point2.lng - point1.lng);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRad(point1.lat)) * Math.cos(this.toRad(point2.lat)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    
    private toRad(degrees: number): number {
        return degrees * (Math.PI / 180);
    }
}

export const osrmClient = new OSRMClient();