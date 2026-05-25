import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

interface SurgeBadgeProps {
    lat: number;
    lng: number;
    basePrice?: number;
    onPriceUpdate?: (finalPrice: number, multiplier: number) => void;
}

export const SurgeBadge: React.FC<SurgeBadgeProps> = ({ 
    lat, 
    lng, 
    basePrice = 10,
    onPriceUpdate 
}) => {
    const [multiplier, setMultiplier] = useState(1.0);
    const [isAnimating, setIsAnimating] = useState(false);
    const [previousMultiplier, setPreviousMultiplier] = useState(1.0);
    const [zoneName, setZoneName] = useState<string>('');
    const [demandRatio, setDemandRatio] = useState<number>(0);
    
    useEffect(() => {
        // Fetch initial surge multiplier
        fetchSurgeMultiplier();
        
        // Listen for real-time surge updates
        const socket = io('http://localhost:3002');
        
        socket.on('surge:updated', (data) => {
            if (data.zoneId === zoneId) {
                updateMultiplier(data.newMultiplier);
            }
        });
        
        return () => {
            socket.disconnect();
        };
    }, [lat, lng]);
    
    const fetchSurgeMultiplier = async () => {
        try {
            const response = await fetch(
                `http://localhost:3001/api/surge/multiplier?lat=${lat}&lng=${lng}`,
                {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                    }
                }
            );
            
            const data = await response.json();
            setMultiplier(data.multiplier);
            setZoneName(data.zone?.name || 'Your Area');
            setDemandRatio(data.zone?.ratio || 0);
            
            if (onPriceUpdate && basePrice) {
                onPriceUpdate(basePrice * data.multiplier, data.multiplier);
            }
        } catch (error) {
            console.error('Failed to fetch surge:', error);
        }
    };
    
    const updateMultiplier = (newMultiplier: number) => {
        setPreviousMultiplier(multiplier);
        setMultiplier(newMultiplier);
        setIsAnimating(true);
        
        if (onPriceUpdate && basePrice) {
            onPriceUpdate(basePrice * newMultiplier, newMultiplier);
        }
        
        setTimeout(() => setIsAnimating(false), 500);
    };
    
    const getSurgeColor = () => {
        if (multiplier <= 1.2) return 'bg-green-100 text-green-800';
        if (multiplier <= 1.5) return 'bg-yellow-100 text-yellow-800';
        if (multiplier <= 2.0) return 'bg-orange-100 text-orange-800';
        if (multiplier <= 3.0) return 'bg-red-100 text-red-800';
        return 'bg-red-800 text-white';
    };
    
    const getSurgeIcon = () => {
        if (multiplier <= 1.2) return '📊';
        if (multiplier <= 1.5) return '⚠️';
        if (multiplier <= 2.0) return '🔥';
        if (multiplier <= 3.0) return '💥';
        return '🚨';
    };
    
    const getSurgeMessage = () => {
        if (multiplier <= 1.0) return 'Normal pricing';
        if (multiplier <= 1.3) return 'Light demand';
        if (multiplier <= 1.7) return 'High demand';
        if (multiplier <= 2.5) return 'Very high demand';
        return 'Extreme demand';
    };
    
    return (
        <div className={`rounded-lg p-4 transition-all duration-500 ${getSurgeColor()} ${isAnimating ? 'scale-105' : ''}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-2xl">{getSurgeIcon()}</span>
                    <div>
                        <p className="text-sm font-medium">Surge Pricing</p>
                        <p className="text-xs opacity-75">{zoneName}</p>
                    </div>
                </div>
                
                <div className="text-right">
                    <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold">{multiplier.toFixed(1)}</span>
                        <span className="text-sm">x</span>
                    </div>
                    <p className="text-xs">{getSurgeMessage()}</p>
                </div>
            </div>
            
            {/* Demand indicator */}
            <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                    <span>Demand: {demandRatio.toFixed(1)}x normal</span>
                    <span>{multiplier > 1 ? `${Math.round((multiplier - 1) * 100)}% higher` : 'Normal'}</span>
                </div>
                <div className="h-2 bg-white/30 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-current rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (multiplier - 1) / 4 * 100)}%` }}
                    />
                </div>
            </div>
            
            {/* Explanation tooltip */}
            {multiplier > 1 && (
                <p className="text-xs mt-2 opacity-75">
                    {multiplier >= 2 
                        ? "Very busy right now. Prices are higher to get more drivers on the road."
                        : "Demand is high. Your fare helps ensure a driver is available."}
                </p>
            )}
        </div>
    );
};