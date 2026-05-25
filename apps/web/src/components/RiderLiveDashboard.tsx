import React, { useState, useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';

interface Ride {
    id: string;
    status: 'idle' | 'searching' | 'accepted' | 'arrived' | 'started' | 'completed';
    driver?: {
        id: string;
        name: string;
        vehicleModel: string;
        vehiclePlate: string;
        rating: number;
        location: { lat: number; lng: number };
        eta: number;
    };
    pickup: { lat: number; lng: number; address: string };
    dropoff: { lat: number; lng: number; address: string };
    fare?: number;
}

export const RiderLiveDashboard: React.FC<{ accessToken: string; userId: string }> = ({ 
    accessToken, 
    userId 
}) => {
    const [ride, setRide] = useState<Ride | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [pickupLocation, setPickupLocation] = useState('');
    const [dropoffLocation, setDropoffLocation] = useState('');
    const [nearbyDrivers, setNearbyDrivers] = useState<any[]>([]);
    
    // Map reference (will be used for MapLibre in Day 10-11)
    const mapRef = useRef<any>(null);
    
    useEffect(() => {
        // Connect to WebSocket
        const newSocket = io('http://localhost:3002', {
            auth: { token: accessToken },
            transports: ['websocket']
        });
        
        newSocket.on('connect', () => {
            console.log('Connected to real-time server');
        });
        
        // Ride request events
        newSocket.on('ride:request:success', (data) => {
            setIsSearching(false);
            setRide(prev => ({
                ...prev!,
                id: data.rideId,
                status: 'accepted',
                driver: {
                    id: data.driverId,
                    name: 'Driver',
                    vehicleModel: 'Vehicle',
                    vehiclePlate: 'Plate',
                    rating: 4.8,
                    location: { lat: 0, lng: 0 },
                    eta: data.eta
                }
            }));
            showNotification('Driver assigned!', 'success');
        });
        
        newSocket.on('ride:request:searching', (data) => {
            setRide({
                id: data.rideId,
                status: 'searching',
                pickup: { lat: 0, lng: 0, address: pickupLocation },
                dropoff: { lat: 0, lng: 0, address: dropoffLocation }
            });
        });
        
        // Driver location updates
        newSocket.on('driver:location:update', (data) => {
            setRide(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    driver: prev.driver ? {
                        ...prev.driver,
                        location: { lat: data.lat, lng: data.lng }
                    } : undefined
                };
            });
            
            // Update map marker
            if (mapRef.current) {
                updateDriverMarker(data.lat, data.lng);
            }
        });
        
        // Ride accepted by driver
        newSocket.on('ride:accepted', (data) => {
            setRide(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    status: 'accepted',
                    driver: {
                        id: data.driverId,
                        name: `Driver ${data.driverId.slice(0, 8)}`,
                        vehicleModel: 'Tesla Model 3',
                        vehiclePlate: 'ABC-123',
                        rating: 4.9,
                        location: { lat: 0, lng: 0 },
                        eta: data.eta
                    }
                };
            });
            showNotification('Driver is on the way!', 'info');
        });
        
        // Driver arrived
        newSocket.on('driver:arrived', (data) => {
            setRide(prev => prev ? { ...prev, status: 'arrived' } : null);
            showNotification('Your driver has arrived!', 'success');
        });
        
        // Ride started
        newSocket.on('ride:started', (data) => {
            setRide(prev => prev ? { ...prev, status: 'started' } : null);
            showNotification('Trip started!', 'info');
        });
        
        // Ride completed
        newSocket.on('ride:completed', (data) => {
            setRide(prev => prev ? { 
                ...prev, 
                status: 'completed',
                fare: data.finalPrice 
            } : null);
            showNotification(`Ride completed! Final fare: $${data.finalPrice}`, 'success');
        });
        
        // Surge updates
        newSocket.on('surge:updated', (data) => {
            if (data.zone === getCurrentZone()) {
                showNotification(`Surge pricing: ${data.multiplier}x`, 'warning');
            }
        });
        
        setSocket(newSocket);
        
        return () => {
            newSocket.disconnect();
        };
    }, [accessToken, pickupLocation, dropoffLocation]);
    
    const getCurrentZone = () => {
        // Determine zone based on pickup location
        return 'downtown';
    };
    
    const updateDriverMarker = (lat: number, lng: number) => {
        // Will implement with MapLibre in Day 10-11
        console.log(`Updating driver marker to: ${lat}, ${lng}`);
    };
    
    const showNotification = (message: string, type: 'success' | 'error' | 'info' | 'warning') => {
        // Implement toast notification
        console.log(`[${type.toUpperCase()}] ${message}`);
    };
    
    const requestRide = async () => {
        if (!pickupLocation || !dropoffLocation) {
            showNotification('Please enter pickup and dropoff locations', 'error');
            return;
        }
        
        setIsSearching(true);
        
        // Get current location
        navigator.geolocation.getCurrentPosition(async (position) => {
            const pickupLat = position.coords.latitude;
            const pickupLng = position.coords.longitude;
            
            // Mock dropoff coordinates (Times Square)
            const dropoffLat = 40.7580;
            const dropoffLng = -73.9855;
            
            socket?.emit('rider:request:ride', {
                pickupLat,
                pickupLng,
                dropoffLat,
                dropoffLng
            });
        }, (error) => {
            console.error('Location error:', error);
            showNotification('Unable to get your location', 'error');
            setIsSearching(false);
        });
    };
    
    const cancelRide = () => {
        if (ride?.id) {
            socket?.emit('rider:cancel:ride', {
                rideId: ride.id,
                reason: 'User cancelled'
            });
            setRide(null);
            setIsSearching(false);
            showNotification('Ride cancelled', 'info');
        }
    };
    
    const rateDriver = (rating: number) => {
        if (ride?.id) {
            socket?.emit('rider:rate:driver', {
                rideId: ride.id,
                rating
            });
        }
    };
    
    return (
        <div className="min-h-screen bg-gray-100">
            {/* Header */}
            <div className="bg-white shadow-sm p-4">
                <h1 className="text-xl font-bold">Ride Dashboard</h1>
            </div>
            
            <div className="container mx-auto px-4 py-6">
                {/* Map Container - MapLibre will go here */}
                <div className="bg-gray-300 h-64 rounded-lg mb-4 flex items-center justify-center">
                    <div ref={mapRef} className="w-full h-full rounded-lg">
                        <p className="text-gray-600">Live Map View</p>
                        <p className="text-xs text-gray-500">(MapLibre integration coming Day 10-11)</p>
                    </div>
                </div>
                
                {/* Ride Request Form */}
                {!ride && !isSearching && (
                    <div className="bg-white rounded-lg shadow p-6">
                        <h2 className="text-lg font-semibold mb-4">Where are you going?</h2>
                        
                        <div className="space-y-3">
                            <input
                                type="text"
                                placeholder="Pickup location"
                                value={pickupLocation}
                                onChange={(e) => setPickupLocation(e.target.value)}
                                className="w-full border p-3 rounded-lg"
                            />
                            
                            <input
                                type="text"
                                placeholder="Dropoff location"
                                value={dropoffLocation}
                                onChange={(e) => setDropoffLocation(e.target.value)}
                                className="w-full border p-3 rounded-lg"
                            />
                            
                            <button
                                onClick={requestRide}
                                className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700"
                            >
                                Request Ride
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Searching State */}
                {isSearching && (
                    <div className="bg-white rounded-lg shadow p-6 text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
                        <h3 className="font-semibold mb-2">Finding you a driver...</h3>
                        <p className="text-sm text-gray-600">This usually takes 10-30 seconds</p>
                        <button
                            onClick={() => setIsSearching(false)}
                            className="mt-4 text-red-600 text-sm"
                        >
                            Cancel
                        </button>
                    </div>
                )}
                
                {/* Active Ride Status */}
                {ride && ride.status !== 'completed' && (
                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        {/* Status Timeline */}
                        <div className="p-4 border-b">
                            <div className="flex justify-between text-sm mb-2">
                                <span className={ride.status === 'accepted' ? 'font-bold text-green-600' : ''}>
                                    Driver Assigned
                                </span>
                                <span className={ride.status === 'arrived' ? 'font-bold text-green-600' : ''}>
                                    Arrived
                                </span>
                                <span className={ride.status === 'started' ? 'font-bold text-green-600' : ''}>
                                    On Trip
                                </span>
                            </div>
                            <div className="h-2 bg-gray-200 rounded-full">
                                <div 
                                    className="h-full bg-green-600 rounded-full transition-all"
                                    style={{
                                        width: ride.status === 'accepted' ? '33%' :
                                               ride.status === 'arrived' ? '66%' :
                                               ride.status === 'started' ? '100%' : '0%'
                                    }}
                                />
                            </div>
                        </div>
                        
                        {/* Driver Info */}
                        {ride.driver && (
                            <div className="p-4 flex items-center gap-3">
                                <div className="w-14 h-14 bg-blue-500 rounded-full flex items-center justify-center text-white text-2xl">
                                    🚗
                                </div>
                                <div className="flex-1">
                                    <p className="font-semibold">{ride.driver.name}</p>
                                    <p className="text-sm text-gray-600">
                                        {ride.driver.vehicleModel} • {ride.driver.vehiclePlate}
                                    </p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <span className="text-yellow-500">★</span>
                                        <span className="text-sm">{ride.driver.rating}</span>
                                    </div>
                                </div>
                                {ride.status === 'accepted' && ride.driver.eta && (
                                    <div className="text-right">
                                        <p className="text-2xl font-bold text-green-600">{ride.driver.eta}</p>
                                        <p className="text-xs text-gray-500">minutes away</p>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Trip Info */}
                        <div className="p-4 border-t bg-gray-50">
                            <div className="flex items-start gap-2 mb-2">
                                <div className="w-4 h-4 bg-green-500 rounded-full mt-1"></div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium">Pickup</p>
                                    <p className="text-sm text-gray-600">{ride.pickup?.address || 'Your location'}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <div className="w-4 h-4 bg-red-500 rounded-full mt-1"></div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium">Dropoff</p>
                                    <p className="text-sm text-gray-600">{ride.dropoff?.address || 'Destination'}</p>
                                </div>
                            </div>
                        </div>
                        
                        {/* Cancel Button */}
                        {ride.status !== 'started' && ride.status !== 'completed' && (
                            <div className="p-4 border-t">
                                <button
                                    onClick={cancelRide}
                                    className="w-full text-red-600 py-2 text-sm font-medium"
                                >
                                    Cancel Ride
                                </button>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Rating Screen */}
                {ride && ride.status === 'completed' && (
                    <div className="bg-white rounded-lg shadow p-6 text-center">
                        <div className="text-4xl mb-4">⭐</div>
                        <h3 className="font-semibold mb-2">Rate your driver</h3>
                        <p className="text-sm text-gray-600 mb-4">Final fare: ${ride.fare?.toFixed(2)}</p>
                        <div className="flex justify-center gap-2 mb-4">
                            {[1, 2, 3, 4, 5].map(star => (
                                <button
                                    key={star}
                                    onClick={() => rateDriver(star)}
                                    className="text-2xl hover:scale-110 transition"
                                >
                                    {star <= 4 ? '☆' : '★'}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setRide(null)}
                            className="text-blue-600 text-sm"
                        >
                            New Ride
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};