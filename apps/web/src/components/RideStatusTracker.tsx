import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';

interface RideStatusTrackerProps {
    rideId: string;
    accessToken: string;
    onRideComplete: () => void;
}

export const RideStatusTracker: React.FC<RideStatusTrackerProps> = ({ 
    rideId, 
    accessToken, 
    onRideComplete 
}) => {
    const [status, setStatus] = useState('searching');
    const [driver, setDriver] = useState<any>(null);
    const [eta, setEta] = useState<number | null>(null);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [socket, setSocket] = useState<any>(null);
    
    useEffect(() => {
        // Connect to WebSocket
        const newSocket = io('http://localhost:3002', {
            transports: ['websocket'],
            auth: { token: accessToken }
        });
        
        newSocket.on('connect', () => {
            newSocket.emit('auth', { token: accessToken });
            newSocket.emit('join:ride', { rideId });
        });
        
        // Ride accepted
        newSocket.on('ride:accepted', (data) => {
            setStatus('accepted');
            setDriver(data);
            setEta(data.eta);
        });
        
        // Driver location updates
        newSocket.on('driver:location:live', (data) => {
            setDriver((prev: any) => ({ ...prev, location: data }));
            
            // Update ETA based on new location
            if (data.distance) {
                setEta(Math.ceil(data.distance / 30 * 60));
            }
        });
        
        // Ride started
        newSocket.on('ride:started', () => {
            setStatus('started');
        });
        
        // Ride completed
        newSocket.on('ride:completed', (data) => {
            setStatus('completed');
            onRideComplete();
        });
        
        setSocket(newSocket);
        
        // Timer for ride duration
        const timer = setInterval(() => {
            if (status === 'started') {
                setElapsedTime(prev => prev + 1);
            }
        }, 1000);
        
        return () => {
            newSocket.disconnect();
            clearInterval(timer);
        };
    }, [rideId, accessToken]);
    
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    
    return (
        <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow">
            <h2 className="text-2xl font-bold mb-4">Ride Status</h2>
            
            {/* Status Timeline */}
            <div className="mb-6">
                <div className="flex justify-between mb-2">
                    <span className={`text-sm ${status === 'searching' ? 'font-bold text-blue-600' : 'text-gray-500'}`}>
                        Searching
                    </span>
                    <span className={`text-sm ${status === 'accepted' ? 'font-bold text-blue-600' : 'text-gray-500'}`}>
                        Driver Assigned
                    </span>
                    <span className={`text-sm ${status === 'started' ? 'font-bold text-blue-600' : 'text-gray-500'}`}>
                        On Trip
                    </span>
                    <span className={`text-sm ${status === 'completed' ? 'font-bold text-green-600' : 'text-gray-500'}`}>
                        Completed
                    </span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-blue-600 transition-all duration-500"
                        style={{
                            width: status === 'searching' ? '25%' :
                                   status === 'accepted' ? '50%' :
                                   status === 'started' ? '75%' : '100%'
                        }}
                    />
                </div>
            </div>
            
            {/* Driver Info */}
            {driver && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white text-xl">
                            🚗
                        </div>
                        <div>
                            <p className="font-semibold">Driver assigned</p>
                            <p className="text-sm text-gray-600">ID: {driver.driverId?.slice(0, 8)}</p>
                        </div>
                    </div>
                    
                    {eta !== null && status === 'accepted' && (
                        <div className="text-center">
                            <p className="text-sm text-gray-600">Arriving in</p>
                            <p className="text-3xl font-bold text-blue-600">{eta} min</p>
                        </div>
                    )}
                    
                    {status === 'started' && (
                        <div className="text-center">
                            <p className="text-sm text-gray-600">Trip duration</p>
                            <p className="text-3xl font-bold text-green-600">{formatTime(elapsedTime)}</p>
                        </div>
                    )}
                </div>
            )}
            
            {/* Loading State */}
            {status === 'searching' && (
                <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Looking for nearby drivers...</p>
                    <p className="text-sm text-gray-400 mt-2">This usually takes 10-30 seconds</p>
                </div>
            )}
            
            {/* Ride Completed */}
            {status === 'completed' && (
                <div className="text-center py-4">
                    <div className="text-4xl mb-2">✅</div>
                    <p className="text-green-600 font-semibold">Ride completed!</p>
                    <button
                        onClick={onRideComplete}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                        Rate & Pay
                    </button>
                </div>
            )}
        </div>
    );
};