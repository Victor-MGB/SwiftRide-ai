import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapProps {
    center: { lat: number; lng: number };
    zoom?: number;
    driverLocation?: { lat: number; lng: number; heading?: number } | null;
    riderLocation?: { lat: number; lng: number } | null;
    pickupLocation?: { lat: number; lng: number } | null;
    dropoffLocation?: { lat: number; lng: number } | null;
    routeGeometry?: string | null;
    onMapClick?: (lngLat: { lng: number; lat: number }) => void;
    onMapLoad?: (map: maplibregl.Map) => void;
}

export const MapLibreMap: React.FC<MapProps> = ({
    center,
    zoom = 13,
    driverLocation,
    riderLocation,
    pickupLocation,
    dropoffLocation,
    routeGeometry,
    onMapClick,
    onMapLoad
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const markers = useRef<{ [key: string]: maplibregl.Marker }>({});
    const [isMapLoaded, setIsMapLoaded] = useState(false);
    
    // Initialize map
    useEffect(() => {
        if (!mapContainer.current || map.current) return;
        
        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://demotiles.maplibre.org/style.json', // Free tile server
            center: [center.lng, center.lat],
            zoom: zoom,
            hash: false
        });
        
        map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
        map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left');
        
        map.current.on('load', () => {
            setIsMapLoaded(true);
            if (onMapLoad && map.current) {
                onMapLoad(map.current);
            }
            
            // Add click handler
            if (onMapClick) {
                map.current!.on('click', (e) => {
                    onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
                });
            }
        });
        
        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, []);
    
    // Update driver marker
    useEffect(() => {
        if (!isMapLoaded || !map.current || !driverLocation) return;
        
        const markerId = 'driver';
        
        if (markers.current[markerId]) {
            markers.current[markerId].setLngLat([driverLocation.lng, driverLocation.lat]);
        } else {
            // Create custom driver marker
            const el = document.createElement('div');
            el.className = 'driver-marker';
            el.innerHTML = `
                <div style="
                    position: relative;
                    width: 32px;
                    height: 32px;
                ">
                    <div style="
                        position: absolute;
                        width: 32px;
                        height: 32px;
                        background: #3B82F6;
                        border: 3px solid white;
                        border-radius: 50%;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    "></div>
                    <div style="
                        position: absolute;
                        top: 28px;
                        left: 14px;
                        width: 4px;
                        height: 10px;
                        background: #3B82F6;
                    "></div>
                </div>
            `;
            
            markers.current[markerId] = new maplibregl.Marker({ element: el })
                .setLngLat([driverLocation.lng, driverLocation.lat])
                .addTo(map.current);
        }
        
        // Rotate marker based on heading
        if (driverLocation.heading && markers.current[markerId].getElement()) {
            const markerEl = markers.current[markerId].getElement();
            const carIcon = markerEl.querySelector('div:first-child') as HTMLElement;
            if (carIcon) {
                carIcon.style.transform = `rotate(${driverLocation.heading}deg)`;
            }
        }
        
        // Center map on driver if on ride
        if (driverLocation && !riderLocation) {
            map.current.flyTo({
                center: [driverLocation.lng, driverLocation.lat],
                zoom: 15,
                duration: 1000
            });
        }
    }, [driverLocation, isMapLoaded]);
    
    // Update rider/pickup marker
    useEffect(() => {
        if (!isMapLoaded || !map.current) return;
        
        const markerId = 'pickup';
        
        if (pickupLocation) {
            if (markers.current[markerId]) {
                markers.current[markerId].setLngLat([pickupLocation.lng, pickupLocation.lat]);
            } else {
                const el = document.createElement('div');
                el.innerHTML = `
                    <div style="
                        width: 24px;
                        height: 24px;
                        background: #10B981;
                        border: 2px solid white;
                        border-radius: 50%;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    "></div>
                `;
                markers.current[markerId] = new maplibregl.Marker({ element: el })
                    .setLngLat([pickupLocation.lng, pickupLocation.lat])
                    .addTo(map.current);
            }
        } else if (markers.current[markerId]) {
            markers.current[markerId].remove();
            delete markers.current[markerId];
        }
    }, [pickupLocation, isMapLoaded]);
    
    // Update dropoff marker
    useEffect(() => {
        if (!isMapLoaded || !map.current) return;
        
        const markerId = 'dropoff';
        
        if (dropoffLocation) {
            if (markers.current[markerId]) {
                markers.current[markerId].setLngLat([dropoffLocation.lng, dropoffLocation.lat]);
            } else {
                const el = document.createElement('div');
                el.innerHTML = `
                    <div style="
                        width: 24px;
                        height: 24px;
                        background: #EF4444;
                        border: 2px solid white;
                        border-radius: 50%;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    "></div>
                `;
                markers.current[markerId] = new maplibregl.Marker({ element: el })
                    .setLngLat([dropoffLocation.lng, dropoffLocation.lat])
                    .addTo(map.current);
            }
        } else if (markers.current[markerId]) {
            markers.current[markerId].remove();
            delete markers.current[markerId];
        }
    }, [dropoffLocation, isMapLoaded]);
    
    // Draw route polyline
    useEffect(() => {
        if (!isMapLoaded || !map.current || !routeGeometry) return;
        
        const sourceId = 'route';
        const layerId = 'route-line';
        
        // Decode polyline
        const coordinates = decodePolyline(routeGeometry);
        
        // Add source
        if (map.current.getSource(sourceId)) {
            (map.current.getSource(sourceId) as maplibregl.GeoJSONSource).setData({
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates
                }
            });
        } else {
            map.current.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates
                    }
                }
            });
            
            map.current.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#3B82F6',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });
        }
        
        // Fit bounds to show entire route
        const bounds = new maplibregl.LngLatBounds();
        coordinates.forEach(coord => bounds.extend(coord as [number, number]));
        map.current.fitBounds(bounds, { padding: 50 });
    }, [routeGeometry, isMapLoaded]);
    
    // Cleanup markers on unmount
    useEffect(() => {
        return () => {
            Object.values(markers.current).forEach(marker => marker.remove());
        };
    }, []);
    
    return (
        <div 
            ref={mapContainer} 
            style={{ width: '100%', height: '100%', minHeight: '400px' }}
            className="rounded-lg shadow-lg"
        />
    );
};

// Polyline decoder (from Google's polyline algorithm)
function decodePolyline(encoded: string): [number, number][] {
    let index = 0;
    const len = encoded.length;
    const points: [number, number][] = [];
    let lat = 0;
    let lng = 0;
    
    while (index < len) {
        let b;
        let shift = 0;
        let result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        
        points.push([lng * 1e-5, lat * 1e-5]);
    }
    
    return points;
}