import React, { useState } from 'react';
import axios from 'axios';

interface RideRequestProps {
    accessToken: string;
    userId: string;
    onRideCreated: (rideId: string) => void;
}

export const RideRequest: React.FC<RideRequestProps> = ({ accessToken, userId, onRideCreated }) => {
    const [pickup, setPickup] = useState({ lat: 40.7128, lng: -74.0060 });
    const [dropoff, setDropoff] = useState({ lat: 40.7580, lng: -73.9855 });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [nearbyDrivers, setNearbyDrivers] = useState<any[]>([]);
    
    // Get current location
    const getCurrentLocation = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setPickup({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    });
                },
                (error) => {
                    console.error('Geolocation error:', error);
                    setError('Unable to get your location');
                }
            );
        }
    };
    
    // Check nearby drivers
    const checkNearbyDrivers = async () => {
        try {
            const response = await axios.get(
                `http://localhost:3001/api/rides/nearby-drivers?lat=${pickup.lat}&lng=${pickup.lng}&radius=3`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            setNearbyDrivers(response.data.drivers);
            return response.data.drivers.length;
        } catch (err) {
            console.error('Error checking drivers:', err);
            return 0;
        }
    };
    
    // Request ride
    const requestRide = async () => {
        setIsLoading(true);
        setError('');
        
        try {
            // First check if drivers are available
            const driverCount = await checkNearbyDrivers();
            
            if (driverCount === 0) {
                setError('No drivers available nearby. Please try again.');
                setIsLoading(false);
                return;
            }
            
            // Request ride
            const response = await axios.post(
                'http://localhost:3001/api/rides/request',
                {
                    pickupLat: pickup.lat,
                    pickupLng: pickup.lng,
                    dropoffLat: dropoff.lat,
                    dropoffLng: dropoff.lng,
                    rideType: 'standard'
                },
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            
            if (response.data.rideId) {
                onRideCreated(response.data.rideId);
            }
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to request ride');
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow">
            <h2 className="text-2xl font-bold mb-4">Request a Ride</h2>
            
            {error && (
                <div className="bg-red-100 text-red-700 p-3 rounded mb-4">
                    {error}
                </div>
            )}
            
            {/* Pickup Location */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Pickup Location</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={`${pickup.lat.toFixed(6)}, ${pickup.lng.toFixed(6)}`}
                        disabled
                        className="flex-1 border p-2 rounded bg-gray-50"
                    />
                    <button
                        onClick={getCurrentLocation}
                        className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                        📍
                    </button>
                </div>
            </div>
            
            {/* Dropoff Location */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Dropoff Location</label>
                <div className="grid grid-cols-2 gap-2">
                    <input
                        type="number"
                        step="0.0001"
                        placeholder="Latitude"
                        value={dropoff.lat}
                        onChange={(e) => setDropoff({ ...dropoff, lat: parseFloat(e.target.value) })}
                        className="border p-2 rounded"
                    />
                    <input
                        type="number"
                        step="0.0001"
                        placeholder="Longitude"
                        value={dropoff.lng}
                        onChange={(e) => setDropoff({ ...dropoff, lng: parseFloat(e.target.value) })}
                        className="border p-2 rounded"
                    />
                </div>
            </div>
            
            {/* Nearby Drivers Status */}
            <div className="mb-4 p-3 bg-gray-50 rounded">
                <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Nearby drivers:</span>
                    <button
                        onClick={checkNearbyDrivers}
                        className="text-sm text-blue-600 hover:text-blue-800"
                    >
                        Refresh
                    </button>
                </div>
                <p className="text-lg font-semibold">
                    {nearbyDrivers.length} drivers available
                </p>
                {nearbyDrivers.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                        Closest driver: {(nearbyDrivers[0]?.distance || 0).toFixed(1)} km away
                    </p>
                )}
            </div>
            
            {/* Request Button */}
            <button
                onClick={requestRide}
                disabled={isLoading}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
            >
                {isLoading ? 'Finding a driver...' : 'Request Ride'}
            </button>
            
            {/* Price Estimate */}
            <div className="mt-4 p-3 bg-gray-100 rounded text-center">
                <p className="text-sm text-gray-600">Estimated fare</p>
                <p className="text-xl font-bold">
                    ${(2.50 + RideMatchingService.calculateDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) * 1.50).toFixed(2)}
                </p>
            </div>
        </div>
    );
};

// Temporary import for price calculation
import { RideMatchingService } from '../../../packages/ride-matching/matching.service';