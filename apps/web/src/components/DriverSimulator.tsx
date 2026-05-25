import React, { useState, useEffect, useCallback, useRef } from 'react';
import io, { Socket } from 'socket.io-client';

interface DriverSimulatorProps {
    driverId: string;
    accessToken: string;
    startLat: number;
    startLng: number;
}

export const DriverSimulator: React.FC<DriverSimulatorProps> = ({
    driverId,
    accessToken,
    startLat,
    startLng,
}) => {
    const [isTracking, setIsTracking] = useState(false);
    const [currentLocation, setCurrentLocation] = useState({ lat: startLat, lng: startLng });
    const [status, setStatus] = useState<'offline' | 'online'>('offline');

    // Use ref instead of state for socket (better practice)
    const socketRef = useRef<Socket | null>(null);
    const intervalRef = useRef<number | null>(null);

    // Socket connection
    useEffect(() => {
        const socket = io('http://localhost:3001', {
            transports: ['websocket'],
            auth: { token: accessToken },
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Driver simulator connected');
            socket.emit('auth', { token: accessToken });
        });

        return () => {
            socket.disconnect();
        };
    }, [accessToken]);

    // Cleanup interval on unmount
    useEffect(() => {
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, []);

    const startTracking = useCallback(() => {
        const socket = socketRef.current;
        if (!socket || isTracking) return;

        setIsTracking(true);
        setStatus('online');

        socket.emit('driver:tracking:start', { interval: 3000 });

        const interval = setInterval(() => {
            setCurrentLocation((prev) => {
                const newLat = prev.lat + (Math.random() - 0.5) * 0.001;
                const newLng = prev.lng + (Math.random() - 0.5) * 0.001;

                const locationUpdate = {
                    lat: newLat,
                    lng: newLng,
                    status: 'online' as const,
                    speed: Math.random() * 60,
                    heading: Math.random() * 360,
                    accuracy: 10,
                };

                // Send via WebSocket
                socket.emit('driver:location:update', locationUpdate);

                // Send via HTTP (redundancy)
                fetch('http://localhost:3001/api/driver/location/update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({
                        latitude: newLat,
                        longitude: newLng,
                        status: 'online',
                    }),
                }).catch(console.error);

                return { lat: newLat, lng: newLng };
            });
        }, 3000);

        intervalRef.current = interval;
    }, [isTracking, accessToken]);

    const stopTracking = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        setIsTracking(false);
        setStatus('offline');

        socketRef.current?.emit('driver:tracking:stop');

        fetch('http://localhost:3001/api/driver/status/set', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ newStatus: 'offline' }),
        }).catch(console.error);
    }, [accessToken]);

    return (
        <div className="p-4 bg-white rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Driver Simulator</h3>

            <div className="space-y-3">
                <div>
                    <label className="block text-sm font-medium mb-1">Driver ID</label>
                    <input
                        type="text"
                        value={driverId}
                        disabled
                        className="w-full border p-2 rounded bg-gray-50"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Current Location</label>
                    <div className="grid grid-cols-2 gap-2">
                        <input
                            type="text"
                            value={currentLocation.lat.toFixed(6)}
                            disabled
                            className="border p-2 rounded bg-gray-50"
                        />
                        <input
                            type="text"
                            value={currentLocation.lng.toFixed(6)}
                            disabled
                            className="border p-2 rounded bg-gray-50"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Status</label>
                    <div
                        className={`px-3 py-2 rounded font-medium ${
                            status === 'online'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-700'
                        }`}
                    >
                        {status.toUpperCase()}
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={startTracking}
                        disabled={isTracking}
                        className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50 transition"
                    >
                        Start Tracking
                    </button>
                    <button
                        onClick={stopTracking}
                        disabled={!isTracking}
                        className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-700 disabled:opacity-50 transition"
                    >
                        Stop Tracking
                    </button>
                </div>

                {isTracking && (
                    <div className="text-sm text-green-600 animate-pulse">
                        ● Live tracking active (updating every 3 seconds)
                    </div>
                )}
            </div>
        </div>
    );
};