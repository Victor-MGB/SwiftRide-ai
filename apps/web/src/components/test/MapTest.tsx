'use client';

import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const MapTest: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);

    useEffect(() => {
        if (!mapContainer.current) return;
        if (map.current) return; // Prevent re-initialization

        // Initialize Map
        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://demotiles.maplibre.org/style.json', // Free demo style
            center: [7.3986, 9.0765], // Abuja, Nigeria (you can change this)
            zoom: 10,
            pitch: 45,
            bearing: 0,
        });

        // Add navigation controls (zoom + rotation)
        map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

        // Add fullscreen control
        map.current.addControl(new maplibregl.FullscreenControl());

        // Optional: Add a marker
        new maplibregl.Marker({ color: '#FF0000' })
            .setLngLat([7.3986, 9.0765])
            .setPopup(new maplibregl.Popup().setHTML('<h3>You are here!</h3>'))
            .addTo(map.current);

        // Cleanup on unmount
        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, []);

    return (
        <div className="w-full h-screen flex flex-col">
            <div className="bg-white shadow p-4 flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">
                    MapLibre GL Test
                </h1>
                <p className="text-sm text-gray-500">Simple MapLibre React Example</p>
            </div>

            <div 
                ref={mapContainer} 
                className="flex-1 w-full"
                style={{ minHeight: '600px' }}
            />
        </div>
    );
};

export default MapTest;