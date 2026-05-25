import React, { useState, useEffect } from 'react';

interface Zone {
    id: string;
    name: string;
    multiplier: number;
    ratio: number;
    activeRiders: number;
    availableDrivers: number;
    manuallyOverridden?: boolean;
}

export const AdminSurgeControl: React.FC = () => {
    const [zones, setZones] = useState<Zone[]>([]);
    const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
    const [manualMultiplier, setManualMultiplier] = useState(1.0);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState<any>(null);
    
    useEffect(() => {
        fetchZones();
        fetchAnalytics();
        
        // Auto-refresh every 30 seconds
        const interval = setInterval(() => {
            fetchZones();
        }, 30000);
        
        return () => clearInterval(interval);
    }, []);
    
    const fetchZones = async () => {
        try {
            const response = await fetch('http://localhost:3001/api/surge/admin/analytics', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                }
            });
            
            const data = await response.json();
            setZones(data.zones);
            setStats(data.summary);
        } catch (error) {
            console.error('Failed to fetch zones:', error);
        }
    };
    
    const fetchAnalytics = async () => {
        try {
            const response = await fetch('http://localhost:3001/api/surge/admin/analytics', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                }
            });
            
            const data = await response.json();
            setStats(data.summary);
        } catch (error) {
            console.error('Failed to fetch analytics:', error);
        }
    };
    
    const handleManualOverride = async () => {
        if (!selectedZone) return;
        
        setLoading(true);
        
        try {
            const response = await fetch('http://localhost:3001/api/surge/admin/manual-override', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                },
                body: JSON.stringify({
                    zoneId: selectedZone.id,
                    multiplier: manualMultiplier
                })
            });
            
            if (response.ok) {
                await fetchZones();
                setSelectedZone(null);
                alert(`Surge multiplier for ${selectedZone.name} set to ${manualMultiplier}x`);
            }
        } catch (error) {
            console.error('Failed to override surge:', error);
            alert('Failed to set surge multiplier');
        } finally {
            setLoading(false);
        }
    };
    
    const handleResetAll = async () => {
        if (!confirm('Reset surge for all zones? This will remove all manual overrides.')) return;
        
        try {
            const response = await fetch('http://localhost:3001/api/surge/admin/reset-all', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                }
            });
            
            if (response.ok) {
                await fetchZones();
                alert('All zones reset to automatic surge pricing');
            }
        } catch (error) {
            console.error('Failed to reset zones:', error);
        }
    };
    
    const getSurgeBadgeColor = (multiplier: number) => {
        if (multiplier <= 1.2) return 'bg-green-100 text-green-800';
        if (multiplier <= 1.5) return 'bg-yellow-100 text-yellow-800';
        if (multiplier <= 2.0) return 'bg-orange-100 text-orange-800';
        if (multiplier <= 3.0) return 'bg-red-100 text-red-800';
        return 'bg-red-800 text-white';
    };
    
    return (
        <div className="p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Surge Pricing Control</h1>
                <p className="text-gray-600">Manage dynamic pricing zones and multipliers</p>
            </div>
            
            {/* Stats Dashboard */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-white rounded-lg shadow p-4">
                        <p className="text-sm text-gray-600">Average Surge</p>
                        <p className="text-2xl font-bold">{stats.averageSurge.toFixed(2)}x</p>
                    </div>
                    <div className="bg-white rounded-lg shadow p-4">
                        <p className="text-sm text-gray-600">Max Surge</p>
                        <p className="text-2xl font-bold text-red-600">{stats.maxSurge.toFixed(1)}x</p>
                    </div>
                    <div className="bg-white rounded-lg shadow p-4">
                        <p className="text-sm text-gray-600">Zones with Surge</p>
                        <p className="text-2xl font-bold">{stats.zonesWithSurge}</p>
                        <p className="text-xs text-gray-500">out of {stats.totalZones}</p>
                    </div>
                    <div className="bg-white rounded-lg shadow p-4">
                        <p className="text-sm text-gray-600">Peak Zone</p>
                        <p className="text-lg font-semibold">{stats.peakSurgeZone?.name}</p>
                        <p className="text-xs text-orange-600">{stats.peakSurgeZone?.multiplier}x surge</p>
                    </div>
                </div>
            )}
            
            {/* Zones List */}
            <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
                <div className="px-4 py-3 border-b bg-gray-50 flex justify-between items-center">
                    <h2 className="font-semibold">Zones</h2>
                    <button
                        onClick={handleResetAll}
                        className="text-sm text-red-600 hover:text-red-800"
                    >
                        Reset All Zones
                    </button>
                </div>
                
                <div className="divide-y">
                    {zones.map(zone => (
                        <div key={zone.id} className="p-4 hover:bg-gray-50 cursor-pointer"
                            onClick={() => setSelectedZone(zone)}>
                            <div className="flex justify-between items-center">
                                <div>
                                    <h3 className="font-medium">{zone.name}</h3>
                                    <div className="flex gap-4 text-sm text-gray-600 mt-1">
                                        <span>Riders: {zone.activeRiders}</span>
                                        <span>Drivers: {zone.availableDrivers}</span>
                                        <span>Ratio: {zone.ratio.toFixed(2)}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className={`px-2 py-1 rounded text-sm font-semibold ${getSurgeBadgeColor(zone.multiplier)}`}>
                                        {zone.multiplier.toFixed(1)}x
                                    </span>
                                    {zone.manuallyOverridden && (
                                        <p className="text-xs text-blue-600 mt-1">Manual Override</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            
            {/* Manual Override Modal */}
            {selectedZone && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full">
                        <h3 className="text-lg font-semibold mb-4">Manual Surge Override</h3>
                        <p className="text-gray-600 mb-4">
                            Zone: <strong>{selectedZone.name}</strong>
                        </p>
                        <p className="text-sm text-gray-500 mb-4">
                            Current multiplier: {selectedZone.multiplier.toFixed(1)}x
                        </p>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-2">
                                New Multiplier (1.0 - 5.0)
                            </label>
                            <input
                                type="range"
                                min="1"
                                max="5"
                                step="0.1"
                                value={manualMultiplier}
                                onChange={(e) => setManualMultiplier(parseFloat(e.target.value))}
                                className="w-full"
                            />
                            <div className="text-center mt-2">
                                <span className="text-2xl font-bold">{manualMultiplier.toFixed(1)}x</span>
                            </div>
                        </div>
                        
                        <div className="flex gap-2">
                            <button
                                onClick={handleManualOverride}
                                disabled={loading}
                                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
                            >
                                {loading ? 'Applying...' : 'Apply Override'}
                            </button>
                            <button
                                onClick={() => setSelectedZone(null)}
                                className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-lg hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};