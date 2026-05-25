import React, { useEffect, useState, useRef, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';

interface DriverLocation {
    driverId: string;
    lat: number;
    lng: number;
    heading?: number;
    speed?: number;
    timestamp: number;
}

interface RiderLiveTrackingProps {
    rideId: string;
    driverId: string;
    accessToken: string;
}

export const RiderLiveTracking: React.FC<RiderLiveTrackingProps> = ({
    rideId,
    driverId,        // Kept for future use and display
    accessToken,
}) => {
    const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    const socketRef = useRef<Socket | null>(null);

    const updateMapMarker = useCallback((lat: number, lng: number) => {
        console.log(`[Map Update] Driver ${driverId} position: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    }, [driverId]);

    useEffect(() => {
        const socket = io('http://localhost:3001', {
            transports: ['websocket'],
            auth: { token: accessToken },
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Connected to tracking server');
            setIsConnected(true);

            socket.emit('auth', { token: accessToken });
            socket.emit('join:ride', { rideId });
        });

        socket.on('driver:location:live', (data: DriverLocation) => {
            setDriverLocation(data);
            setLastUpdate(new Date());
            updateMapMarker(data.lat, data.lng);
        });

        socket.on('driver:eta:update', (data: { eta: number; distance: number }) => {
            console.log(`ETA: ${data.eta} minutes, Distance: ${data.distance} km`);
        });

        socket.on('disconnect', () => {
            setIsConnected(false);
        });

        return () => {
            socket.disconnect();
        };
    }, [rideId, accessToken, updateMapMarker]);

    return (
        <div className="p-4 bg-white rounded-lg shadow">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Driver Live Tracking</h3>
                <div className="flex items-center gap-2">
                    <div
                        className={`w-2 h-2 rounded-full ${
                            isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                        }`}
                    />
                    <span className="text-sm text-gray-600">
                        {isConnected ? 'Live' : 'Connecting...'}
                    </span>
                </div>
            </div>

            {driverLocation ? (
                <div className="space-y-4">
                    {/* Driver Info */}
                    <div>
                        <p className="text-xs text-gray-500">Driver ID</p>
                        <p className="font-mono text-sm font-medium">{driverId}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-xs text-gray-500">Latitude</p>
                            <p className="font-mono text-sm">{driverLocation.lat.toFixed(6)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Longitude</p>
                            <p className="font-mono text-sm">{driverLocation.lng.toFixed(6)}</p>
                        </div>
                    </div>

                    {driverLocation.speed && (
                        <div>
                            <p className="text-xs text-gray-500">Speed</p>
                            <p className="font-semibold">{driverLocation.speed.toFixed(1)} km/h</p>
                        </div>
                    )}

                    {lastUpdate && (
                        <p className="text-xs text-gray-400">
                            Last update: {lastUpdate.toLocaleTimeString()}
                        </p>
                    )}

                    {/* Map Placeholder */}
                    <div className="mt-4 h-64 bg-gray-100 rounded-lg flex items-center justify-center border border-gray-200">
                        <p className="text-gray-500 text-sm">
                            🗺️ Live Map View (MapLibre coming soon)
                        </p>
                    </div>
                </div>
            ) : (
                <div className="text-center py-12 text-gray-500">
                    Waiting for driver location...
                </div>
            )}
        </div>
    );
};