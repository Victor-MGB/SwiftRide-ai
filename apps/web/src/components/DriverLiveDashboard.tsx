import React, { useState, useEffect } from 'react';
import io, { Socket } from 'socket.io-client';

interface RideRequest {
    rideId: string;
    riderId: string;
    pickupLat: number;
    pickupLng: number;
    distance: number;
    eta: number;
}

interface ActiveRide {
    rideId: string;
    riderId: string;
    status: 'accepted' | 'arrived' | 'started';
    pickup: { lat: number; lng: number };
    dropoff: { lat: number; lng: number };
}

export const DriverLiveDashboard: React.FC<{ accessToken: string; driverId: string }> = ({ 
    accessToken, 
    driverId 
}) => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isOnline, setIsOnline] = useState(false);
    const [currentLocation, setCurrentLocation] = useState({ lat: 0, lng: 0 });
    const [pendingRequests, setPendingRequests] = useState<RideRequest[]>([]);
    const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
    const [trackingInterval, setTrackingInterval] = useState<NodeJS.Timeout | null>(null);
    
    useEffect(() => {
        // Connect to WebSocket
        const newSocket = io('http://localhost:3002', {
            auth: { token: accessToken },
            transports: ['websocket']
        });
        
        newSocket.on('connect', () => {
            console.log('Driver connected to server');
        });
        
        // New ride request
        newSocket.on('ride:new:request', (data: RideRequest) => {
            setPendingRequests(prev => [...prev, data]);
            
            // Play notification sound
            playNotificationSound();
            
            // Show browser notification
            if (Notification.permission === 'granted') {
                new Notification('New Ride Request!', {
                    body: `Pickup ${data.distance.toFixed(1)} km away • Est. ${Math.ceil(data.eta)} min`
                });
            }
        });
        
        // Ride accept success
        newSocket.on('ride:accept:success', (data) => {
            setPendingRequests([]);
            setActiveRide({
                rideId: data.rideId,
                riderId: '',
                status: 'accepted',
                pickup: { lat: 0, lng: 0 },
                dropoff: { lat: 0, lng: 0 }
            });
            showToast('Ride accepted! Navigate to pickup', 'success');
        });
        
        // Ride accept failed (already taken)
        newSocket.on('ride:accept:failed', (data) => {
            setPendingRequests(prev => prev.filter(r => r.rideId !== data.rideId));
            showToast('Ride no longer available', 'error');
        });
        
        // Location update acknowledgment
        newSocket.on('location:ack', (data) => {
            // console.log('Location sent at:', new Date(data.timestamp));
        });
        
        setSocket(newSocket);
        
        // Request notification permission
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
        
        return () => {
            if (trackingInterval) clearInterval(trackingInterval);
            newSocket.disconnect();
        };
    }, [accessToken]);
    
    const playNotificationSound = () => {
        const audio = new Audio('/notification.mp3');
        audio.play().catch(e => console.log('Audio play failed:', e));
    };
    
    const showToast = (message: string, type: string) => {
        // Implement toast notification
        console.log(`[${type}] ${message}`);
    };
    
    const startTracking = () => {
        if (!navigator.geolocation) {
            showToast('Geolocation not supported', 'error');
            return;
        }
        
        setIsOnline(true);
        
        // Get initial location
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                setCurrentLocation({ lat: latitude, lng: longitude });
                
                // Set driver online
                fetch('http://localhost:3001/api/driver/status/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        newStatus: 'online',
                        latitude,
                        longitude
                    })
                });
            },
            (error) => {
                console.error('Geolocation error:', error);
                showToast('Unable to get location', 'error');
                setIsOnline(false);
            }
        );
        
        // Start tracking interval (every 3 seconds)
        const interval = setInterval(() => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude, speed, heading } = position.coords;
                    setCurrentLocation({ lat: latitude, lng: longitude });
                    
                    // Send location via WebSocket
                    socket?.emit('driver:location:live', {
                        lat: latitude,
                        lng: longitude,
                        status: activeRide ? 'on_ride' : 'online',
                        rideId: activeRide?.rideId,
                        speed: speed || 0,
                        heading: heading || 0
                    });
                    
                    // Also send via HTTP as backup
                    fetch('http://localhost:3001/api/driver/location/update', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${accessToken}`
                        },
                        body: JSON.stringify({
                            latitude,
                            longitude,
                            status: activeRide ? 'on_ride' : 'online',
                            rideId: activeRide?.rideId
                        })
                    }).catch(console.error);
                },
                (error) => {
                    console.error('Location update error:', error);
                },
                { enableHighAccuracy: true, timeout: 5000 }
            );
        }, 3000);
        
        setTrackingInterval(interval);
    };
    
    const stopTracking = () => {
        setIsOnline(false);
        
        if (trackingInterval) {
            clearInterval(trackingInterval);
            setTrackingInterval(null);
        }
        
        // Set driver offline
        fetch('http://localhost:3001/api/driver/status/set', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ newStatus: 'offline' })
        });
        
        showToast('You are now offline', 'info');
    };
    
    const acceptRide = (rideId: string) => {
        socket?.emit('driver:accept:ride', { rideId });
    };
    
    const rejectRide = (rideId: string) => {
        setPendingRequests(prev => prev.filter(r => r.rideId !== rideId));
        socket?.emit('driver:reject:ride', { rideId });
    };
    
    const driverArrived = () => {
        if (activeRide) {
            socket?.emit('driver:arrived', { rideId: activeRide.rideId });
            setActiveRide(prev => prev ? { ...prev, status: 'arrived' } : null);
            showToast('Notified rider that you have arrived', 'success');
        }
    };
    
    const startRide = () => {
        if (activeRide) {
            socket?.emit('driver:start:ride', { rideId: activeRide.rideId });
            setActiveRide(prev => prev ? { ...prev, status: 'started' } : null);
            showToast('Trip started', 'success');
        }
    };
    
    const completeRide = () => {
        if (activeRide) {
            socket?.emit('driver:complete:ride', { rideId: activeRide.rideId });
            setActiveRide(null);
            showToast('Ride completed!', 'success');
        }
    };
    
    return (
        <div className="min-h-screen bg-gray-100">
            {/* Header */}
            <div className="bg-white shadow-sm p-4 flex justify-between items-center">
                <h1 className="text-xl font-bold">Driver Dashboard</h1>
                <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span className="text-sm">{isOnline ? 'Online' : 'Offline'}</span>
                </div>
            </div>
            
            <div className="container mx-auto px-4 py-6">
                {/* Go Online/Offline Button */}
                {!isOnline ? (
                    <button
                        onClick={startTracking}
                        className="w-full bg-green-600 text-white py-4 rounded-lg font-semibold text-lg mb-6"
                    >
                        Go Online
                    </button>
                ) : (
                    <button
                        onClick={stopTracking}
                        className="w-full bg-red-600 text-white py-4 rounded-lg font-semibold text-lg mb-6"
                    >
                        Go Offline
                    </button>
                )}
                
                {/* Current Location */}
                {isOnline && (
                    <div className="bg-white rounded-lg shadow p-4 mb-6">
                        <p className="text-sm text-gray-600 mb-1">Current Location</p>
                        <p className="font-mono text-sm">
                            {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}
                        </p>
                        <p className="text-xs text-green-600 mt-2">
                            ● Live tracking active (updating every 3 seconds)
                        </p>
                    </div>
                )}
                
                {/* Pending Ride Requests */}
                {pendingRequests.length > 0 && (
                    <div className="mb-6">
                        <h2 className="font-semibold mb-3 flex items-center gap-2">
                            <span className="animate-pulse">🔔</span>
                            New Ride Requests ({pendingRequests.length})
                        </h2>
                        
                        {pendingRequests.map(request => (
                            <div key={request.rideId} className="bg-white rounded-lg shadow p-4 mb-3">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <p className="font-semibold">Ride Request</p>
                                        <p className="text-sm text-gray-600">
                                            {request.distance.toFixed(1)} km away
                                        </p>
                                        <p className="text-sm text-gray-600">
                                            Est. pickup: {Math.ceil(request.eta)} min
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl font-bold text-green-600">
                                            ${(2.50 + request.distance * 1.50).toFixed(2)}
                                        </p>
                                        <p className="text-xs text-gray-500">estimated fare</p>
                                    </div>
                                </div>
                                
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => acceptRide(request.rideId)}
                                        className="flex-1 bg-green-600 text-white py-2 rounded-lg font-medium"
                                    >
                                        Accept
                                    </button>
                                    <button
                                        onClick={() => rejectRide(request.rideId)}
                                        className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium"
                                    >
                                        Decline
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                
                {/* Active Ride */}
                {activeRide && (
                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        <div className="bg-blue-600 text-white p-4">
                            <h3 className="font-semibold">Active Ride</h3>
                            <p className="text-sm opacity-90">Ride ID: {activeRide.rideId.slice(0, 8)}</p>
                        </div>
                        
                        <div className="p-4">
                            {/* Status */}
                            <div className="mb-4">
                                <div className="flex justify-between text-sm mb-2">
                                    <span className={activeRide.status === 'accepted' ? 'font-bold text-blue-600' : ''}>
                                        Heading to Pickup
                                    </span>
                                    <span className={activeRide.status === 'arrived' ? 'font-bold text-blue-600' : ''}>
                                        Arrived
                                    </span>
                                    <span className={activeRide.status === 'started' ? 'font-bold text-blue-600' : ''}>
                                        On Trip
                                    </span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full">
                                    <div 
                                        className="h-full bg-blue-600 rounded-full transition-all"
                                        style={{
                                            width: activeRide.status === 'accepted' ? '33%' :
                                                   activeRide.status === 'arrived' ? '66%' : '100%'
                                        }}
                                    />
                                </div>
                            </div>
                            
                            {/* Action Buttons */}
                            <div className="space-y-2">
                                {activeRide.status === 'accepted' && (
                                    <button
                                        onClick={driverArrived}
                                        className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold"
                                    >
                                        I've Arrived
                                    </button>
                                )}
                                
                                {activeRide.status === 'arrived' && (
                                    <button
                                        onClick={startRide}
                                        className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold"
                                    >
                                        Start Trip
                                    </button>
                                )}
                                
                                {activeRide.status === 'started' && (
                                    <button
                                        onClick={completeRide}
                                        className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold"
                                    >
                                        Complete Ride
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Stats Card when online with no rides */}
                {isOnline && pendingRequests.length === 0 && !activeRide && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-4xl mb-3">🚗</div>
                        <p className="text-gray-600">Waiting for ride requests</p>
                        <p className="text-sm text-gray-400 mt-2">You'll be notified when a rider requests a ride</p>
                    </div>
                )}
            </div>
        </div>
    );
};