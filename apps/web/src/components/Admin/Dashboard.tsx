import React, { useState, useEffect } from 'react';
import { 
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
    Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell 
} from 'recharts';
import { io } from 'socket.io-client';

interface RealtimeMetrics {
    activeDrivers: number;
    activeRides: number;
    activeRiders: number;
    surgeZones: Array<{ zone: string; multiplier: number }>;
    avgETA: number;
    completedToday: number;
}

interface HistoricalMetrics {
    ridesPerHour: Array<{ hour: string; count: number }>;
    revenuePerDay: Array<{ date: string; amount: number }>;
    avgETATrend: Array<{ hour: string; eta: number }>;
    surgeOccurrences: Array<{ hour: string; count: number }>;
}

export const AdminDashboard: React.FC = () => {
    const [realtime, setRealtime] = useState<RealtimeMetrics | null>(null);
    const [historical, setHistorical] = useState<HistoricalMetrics | null>(null);
    const [drivers, setDrivers] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('overview');
    const [lastUpdated, setLastUpdated] = useState(new Date());
    
    useEffect(() => {
        // Initial fetch
        fetchMetrics();
        fetchDrivers();
        
        // WebSocket for real-time updates
        const socket = io('http://localhost:3002', {
            auth: { token: localStorage.getItem('accessToken') }
        });
        
        socket.on('admin:metrics:update', (data) => {
            setRealtime(data);
            setLastUpdated(new Date());
        });
        
        socket.on('surge:updated', (data) => {
            fetchMetrics(); // Refresh metrics
        });
        
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchMetrics, 30000);
        
        return () => {
            clearInterval(interval);
            socket.disconnect();
        };
    }, []);
    
    const fetchMetrics = async () => {
        try {
            const [realtimeRes, historicalRes] = await Promise.all([
                fetch('http://localhost:3001/api/admin/metrics/realtime', {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
                }),
                fetch('http://localhost:3001/api/admin/metrics/historical?days=7', {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
                })
            ]);
            
            const realtimeData = await realtimeRes.json();
            const historicalData = await historicalRes.json();
            
            setRealtime(realtimeData);
            setHistorical(historicalData);
        } catch (error) {
            console.error('Failed to fetch metrics:', error);
        }
    };
    
    const fetchDrivers = async () => {
        try {
            const response = await fetch('http://localhost:3001/api/admin/drivers?limit=20', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
            });
            const data = await response.json();
            setDrivers(data);
        } catch (error) {
            console.error('Failed to fetch drivers:', error);
        }
    };
    
    const deactivateDriver = async (driverId: string) => {
        if (!confirm('Are you sure you want to deactivate this driver?')) return;
        
        try {
            await fetch(`http://localhost:3001/api/admin/drivers/${driverId}/deactivate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                },
                body: JSON.stringify({ reason: 'Admin deactivation' })
            });
            
            fetchDrivers();
        } catch (error) {
            console.error('Failed to deactivate driver:', error);
        }
    };
    
    const COLORS = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
    
    return (
        <div className="min-h-screen bg-gray-100">
            {/* Header */}
            <div className="bg-white shadow-sm">
                <div className="px-6 py-4">
                    <h1 className="text-2xl font-bold">Admin Dashboard</h1>
                    <p className="text-sm text-gray-500">
                        Last updated: {lastUpdated.toLocaleTimeString()}
                    </p>
                </div>
            </div>
            
            {/* Navigation Tabs */}
            <div className="border-b bg-white">
                <div className="px-6 flex gap-6">
                    {['overview', 'drivers', 'rides', 'surge', 'analytics'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`py-3 px-1 capitalize transition-colors ${
                                activeTab === tab 
                                    ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>
            
            <div className="p-6">
                {activeTab === 'overview' && realtime && (
                    <>
                        {/* Real-time Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                            <div className="bg-white rounded-lg shadow p-4">
                                <p className="text-sm text-gray-500">Active Drivers</p>
                                <p className="text-2xl font-bold text-blue-600">{realtime.activeDrivers}</p>
                                <span className="text-xs text-green-600">+12% from yesterday</span>
                            </div>
                            
                            <div className="bg-white rounded-lg shadow p-4">
                                <p className="text-sm text-gray-500">Active Rides</p>
                                <p className="text-2xl font-bold text-green-600">{realtime.activeRides}</p>
                            </div>
                            
                            <div className="bg-white rounded-lg shadow p-4">
                                <p className="text-sm text-gray-500">Active Riders</p>
                                <p className="text-2xl font-bold text-purple-600">{realtime.activeRiders}</p>
                            </div>
                            
                            <div className="bg-white rounded-lg shadow p-4">
                                <p className="text-sm text-gray-500">Avg ETA (min)</p>
                                <p className="text-2xl font-bold text-orange-600">{realtime.avgETA}</p>
                            </div>
                            
                            <div className="bg-white rounded-lg shadow p-4">
                                <p className="text-sm text-gray-500">Completed Today</p>
                                <p className="text-2xl font-bold text-teal-600">{realtime.completedToday}</p>
                            </div>
                        </div>
                        
                        {/* Charts */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                            <div className="bg-white rounded-lg shadow p-4">
                                <h3 className="font-semibold mb-4">Rides Per Hour (Last 24h)</h3>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={historical?.ridesPerHour}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="hour" tickFormatter={(v) => new Date(v).getHours() + 'h'} />
                                        <YAxis />
                                        <Tooltip />
                                        <Bar dataKey="count" fill="#3B82F6" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            
                            <div className="bg-white rounded-lg shadow p-4">
                                <h3 className="font-semibold mb-4">Revenue Trend (Last 7 Days)</h3>
                                <ResponsiveContainer width="100%" height={300}>
                                    <LineChart data={historical?.revenuePerDay}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" />
                                        <YAxis />
                                        <Tooltip />
                                        <Line type="monotone" dataKey="amount" stroke="#10B981" strokeWidth={2} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                        
                        {/* Surge Zones */}
                        <div className="bg-white rounded-lg shadow p-4">
                            <h3 className="font-semibold mb-4">Active Surge Zones</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                {realtime.surgeZones.map(zone => (
                                    <div key={zone.zone} className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                                        <p className="text-sm font-medium">{zone.zone}</p>
                                        <p className="text-xl font-bold text-red-600">{zone.multiplier}x</p>
                                    </div>
                                ))}
                                {realtime.surgeZones.length === 0 && (
                                    <p className="text-gray-500 col-span-full">No active surge zones</p>
                                )}
                            </div>
                        </div>
                    </>
                )}
                
                {activeTab === 'drivers' && (
                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        <div className="px-4 py-3 border-b bg-gray-50">
                            <h3 className="font-semibold">Driver Management</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-sm">Name</th>
                                        <th className="px-4 py-3 text-left text-sm">Email</th>
                                        <th className="px-4 py-3 text-left text-sm">Vehicle</th>
                                        <th className="px-4 py-3 text-left text-sm">Rating</th>
                                        <th className="px-4 py-3 text-left text-sm">Trips</th>
                                        <th className="px-4 py-3 text-left text-sm">Status</th>
                                        <th className="px-4 py-3 text-left text-sm">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {drivers.map(driver => (
                                        <tr key={driver.id}>
                                            <td className="px-4 py-3">{driver.full_name}</td>
                                            <td className="px-4 py-3 text-sm">{driver.email}</td>
                                            <td className="px-4 py-3 text-sm">{driver.vehicle_model}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-1">
                                                    <span>⭐</span>
                                                    <span>{driver.rating}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">{driver.total_trips}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded text-xs ${
                                                    driver.is_online ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {driver.is_online ? 'Online' : 'Offline'}
                                                </span>
                                                {!driver.is_approved && (
                                                    <span className="ml-2 px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800">
                                                        Pending Approval
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex gap-2">
                                                    {!driver.is_approved && (
                                                        <button className="text-green-600 hover:text-green-800 text-sm">
                                                            Approve
                                                        </button>
                                                    )}
                                                    {driver.is_active && (
                                                        <button 
                                                            onClick={() => deactivateDriver(driver.id)}
                                                            className="text-red-600 hover:text-red-800 text-sm"
                                                        >
                                                            Deactivate
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                
                {activeTab === 'surge' && (
                    <div className="bg-white rounded-lg shadow p-4">
                        <h3 className="font-semibold mb-4">Manual Surge Override</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {realtime?.surgeZones.map(zone => (
                                <div key={zone.zone} className="border rounded-lg p-4">
                                    <p className="font-medium">{zone.zone}</p>
                                    <p className="text-2xl font-bold my-2">{zone.multiplier}x</p>
                                    <input 
                                        type="range" 
                                        min="1" 
                                        max="5" 
                                        step="0.1"
                                        defaultValue={zone.multiplier}
                                        className="w-full"
                                        onChange={(e) => {
                                            // Handle surge override
                                            console.log(`Set ${zone.zone} to ${e.target.value}x`);
                                        }}
                                    />
                                    <button className="mt-2 w-full bg-blue-600 text-white py-1 rounded text-sm">
                                        Apply Override
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};