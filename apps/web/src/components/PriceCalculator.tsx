import React, { useState, useEffect } from 'react';

interface PriceCalculatorProps {
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    distance: number; // in km
    estimatedDuration: number; // in minutes
}

export const PriceCalculator: React.FC<PriceCalculatorProps> = ({
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    distance,
    estimatedDuration
}) => {
    const [basePrice, setBasePrice] = useState(0);
    const [surgeMultiplier, setSurgeMultiplier] = useState(1.0);
    const [finalPrice, setFinalPrice] = useState(0);
    const [priceBreakdown, setPriceBreakdown] = useState<any>(null);
    
    const BASE_FARE = 2.50;
    const PER_KM_RATE = 1.50;
    const PER_MINUTE_RATE = 0.30;
    
    useEffect(() => {
        calculateBasePrice();
        fetchSurgeMultiplier();
    }, [distance, estimatedDuration, pickupLat, pickupLng]);
    
    const calculateBasePrice = () => {
        const calculatedBase = BASE_FARE + (distance * PER_KM_RATE) + (estimatedDuration * PER_MINUTE_RATE);
        setBasePrice(calculatedBase);
        setFinalPrice(calculatedBase * surgeMultiplier);
        
        setPriceBreakdown({
            baseFare: BASE_FARE,
            distanceFee: distance * PER_KM_RATE,
            timeFee: estimatedDuration * PER_MINUTE_RATE,
            subtotal: calculatedBase,
            surgeMultiplier,
            surgeAmount: calculatedBase * (surgeMultiplier - 1),
            total: calculatedBase * surgeMultiplier
        });
    };
    
    const fetchSurgeMultiplier = async () => {
        try {
            const response = await fetch(
                `http://localhost:3001/api/surge/multiplier?lat=${pickupLat}&lng=${pickupLng}`,
                {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                    }
                }
            );
            
            const data = await response.json();
            setSurgeMultiplier(data.multiplier);
            setFinalPrice(basePrice * data.multiplier);
        } catch (error) {
            console.error('Failed to fetch surge:', error);
        }
    };
    
    return (
        <div className="bg-white rounded-lg shadow-lg p-4">
            <h3 className="font-semibold text-lg mb-3">Fare Breakdown</h3>
            
            {/* Price Breakdown */}
            <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Base fare</span>
                    <span>${priceBreakdown?.baseFare.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Distance ({distance.toFixed(1)} km)</span>
                    <span>${priceBreakdown?.distanceFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Time ({Math.ceil(estimatedDuration)} min)</span>
                    <span>${priceBreakdown?.timeFee.toFixed(2)}</span>
                </div>
                
                {surgeMultiplier > 1 && (
                    <>
                        <div className="border-t pt-2 mt-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-orange-600 font-medium">Surge Multiplier</span>
                                <span className="text-orange-600 font-medium">{surgeMultiplier.toFixed(1)}x</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Surge amount</span>
                                <span className="text-orange-600">+${priceBreakdown?.surgeAmount.toFixed(2)}</span>
                            </div>
                        </div>
                    </>
                )}
                
                <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between font-bold">
                        <span>Total</span>
                        <span className="text-xl text-green-600">${finalPrice.toFixed(2)}</span>
                    </div>
                </div>
            </div>
            
            {/* Surge Notification */}
            {surgeMultiplier > 1.5 && (
                <div className="bg-orange-50 border border-orange-200 rounded p-3">
                    <p className="text-sm text-orange-800">
                        ⚠️ Prices are {Math.round((surgeMultiplier - 1) * 100)}% higher than usual due to high demand.
                    </p>
                </div>
            )}
            
            {/* Price Alert for extreme surge */}
            {surgeMultiplier > 3 && (
                <div className="bg-red-50 border border-red-200 rounded p-3 mt-2">
                    <p className="text-sm text-red-800">
                        🚨 Extreme surge! Consider waiting a few minutes or walking to a nearby area.
                    </p>
                </div>
            )}
        </div>
    );
};