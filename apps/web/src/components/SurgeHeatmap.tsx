import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

interface SurgeDataPoint {
    lat: number;
    lng: number;
    multiplier: number;
    intensity: number;
    color: string;
}

export const SurgeHeatmap: React.FC<{ map: maplibregl.Map | null }> = ({ map }) => {
    const [surgeData, setSurgeData] = useState<SurgeDataPoint[]>([]);
    const heatmapSourceRef = useRef<string>('surge-heatmap');
    
    useEffect(() => {
        if (!map) return;
        
        // Fetch surge data every minute
        fetchSurgeData();
        const interval = setInterval(fetchSurgeData, 60000);
        
        return () => clearInterval(interval);
    }, [map]);
    
    const fetchSurgeData = async () => {
        try {
            const response = await fetch('http://localhost:3001/api/surge/heatmap', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                }
            });
            
            const data = await response.json();
            setSurgeData(data.data);
            updateHeatmapLayer(data.data);
        } catch (error) {
            console.error('Failed to fetch surge heatmap:', error);
        }
    };
    
    const updateHeatmapLayer = (data: SurgeDataPoint[]) => {
        if (!map) return;
        
        // Convert to GeoJSON
        const geojson = {
            type: 'FeatureCollection' as const,
            features: data.map(point => ({
                type: 'Feature' as const,
                geometry: {
                    type: 'Point' as const,
                    coordinates: [point.lng, point.lat]
                },
                properties: {
                    multiplier: point.multiplier,
                    intensity: point.intensity,
                    color: point.color
                }
            }))
        };
        
        // Add or update source
        if (map.getSource(heatmapSourceRef.current)) {
            (map.getSource(heatmapSourceRef.current) as maplibregl.GeoJSONSource).setData(geojson);
        } else {
            map.addSource(heatmapSourceRef.current, {
                type: 'geojson',
                data: geojson
            });
            
            // Add heatmap layer
            map.addLayer({
                id: 'surge-heatmap-layer',
                type: 'circle',
                source: heatmapSourceRef.current,
                paint: {
                    'circle-radius': [
                        'interpolate',
                        ['linear'],
                        ['get', 'intensity'],
                        0, 20,
                        1, 80
                    ],
                    'circle-color': [
                        'interpolate',
                        ['linear'],
                        ['get', 'intensity'],
                        0, '#10B981',
                        0.3, '#F59E0B',
                        0.6, '#F97316',
                        0.8, '#EF4444',
                        1, '#991B1B'
                    ],
                    'circle-opacity': 0.6,
                    'circle-blur': 0.5
                }
            });
            
            // Add labels for surge zones
            map.addLayer({
                id: 'surge-labels',
                type: 'symbol',
                source: heatmapSourceRef.current,
                layout: {
                    'text-field': ['concat', '🚨 ', ['to-string', ['get', 'multiplier']], 'x'],
                    'text-size': 12,
                    'text-offset': [0, -1.5]
                },
                paint: {
                    'text-color': '#FFFFFF',
                    'text-halo-color': '#000000',
                    'text-halo-width': 1
                }
            });
        }
    };
    
    return null; // This is a controller component, no UI
};