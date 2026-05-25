import React, { useState, useEffect } from 'react';

interface ETADisplayProps {
    rideId: string;
    initialETA: number; // in seconds
    onETAUpdate?: (eta: number) => void;
}

export const ETADisplay: React.FC<ETADisplayProps> = ({ rideId, initialETA, onETAUpdate }) => {
    const [eta, setEta] = useState(initialETA);
    const [distance, setDistance] = useState<number | null>(null);
    const [isRecalculating, setIsRecalculating] = useState(false);
    
    useEffect(() => {
        // Connect to WebSocket for ETA updates
        const socket = new WebSocket('ws://localhost:3002');
        
        socket.onopen = () => {
            socket.send(JSON.stringify({
                event: 'subscribe',
                channel: `ride:${rideId}:eta`
            }));
        };
        
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'eta_update') {
                setEta(data.etaSeconds);
                setDistance(data.distance);
                setIsRecalculating(false);
                if (onETAUpdate) onETAUpdate(data.etaSeconds);
            } else if (data.type === 'eta_recalculating') {
                setIsRecalculating(true);
            }
        };
        
        return () => {
            socket.close();
        };
    }, [rideId]);
    
    const formatETA = (seconds: number): string => {
        const minutes = Math.ceil(seconds / 60);
        if (minutes < 1) return '< 1 min';
        if (minutes === 1) return '1 min';
        return `${minutes} mins`;
    };
    
    const formatDistance = (km: number): string => {
        if (km < 1) return `${Math.round(km * 1000)} m`;
        return `${km.toFixed(1)} km`;
    };
    
    return (
        <div className="bg-white rounded-lg shadow-lg p-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-500">Driver ETA</h3>
                {isRecalculating && (
                    <div className="flex items-center gap-1">
                        <div className="animate-spin rounded-full w-3 h-3 border-b-2 border-blue-600"></div>
                        <span className="text-xs text-gray-400">Updating...</span>
                    </div>
                )}
            </div>
            
            <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-blue-600">
                    {formatETA(eta)}
                </span>
                {distance && (
                    <span className="text-sm text-gray-500">
                        • {formatDistance(distance)} away
                    </span>
                )}
            </div>
            
            {/* ETA Progress Bar */}
            <div className="mt-3">
                <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-blue-600 transition-all duration-500"
                        style={{ 
                            width: `${Math.min(100, (initialETA - eta) / initialETA * 100)}%` 
                        }}
                    />
                </div>
            </div>
            
            {/* Traffic Indicator */}
            <div className="mt-2 text-xs text-gray-400 flex items-center gap-2">
                <span>📍 Real-time traffic</span>
                <span>•</span>
                <span>🔄 Updates every 30s</span>
            </div>
        </div>
    );
};