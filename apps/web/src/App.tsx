import { useState } from 'react';
import { DriverOnboardingForm } from './components/DriverOnboarding';
import { DriverSimulator } from './components/DriverSimulator';
import { RiderLiveTracking } from './components/RiderLiveTracking';
import MapTest from './components/test/MapTest';   // ← Import the map

function App() {
  const [driverId, setDriverId] = useState('');
  const [rideId, setRideId] = useState('');
  const [accessToken, setAccessToken] = useState('');

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800">
          Swiftride AI - Component Testing Dashboard
        </h1>

        {/* Test Credentials Input */}
        <div className="bg-white p-6 rounded-xl shadow mb-8 max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold mb-4">Test Credentials</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Driver ID</label>
              <input
                type="text"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                placeholder="driver_12345"
                className="w-full border border-gray-300 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Ride ID</label>
              <input
                type="text"
                value={rideId}
                onChange={(e) => setRideId(e.target.value)}
                placeholder="ride_67890"
                className="w-full border border-gray-300 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Access Token</label>
              <input
                type="text"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Paste your JWT token here"
                className="w-full border border-gray-300 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Driver Onboarding */}
          <div>
            <h2 className="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">
              1. Driver Onboarding
            </h2>
            <DriverOnboardingForm />
          </div>

          {/* Driver Simulator */}
          <div>
            <h2 className="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">
              2. Driver Simulator
            </h2>
            {driverId && accessToken ? (
              <DriverSimulator
                driverId={driverId}
                accessToken={accessToken}
                startLat={6.5244}
                startLng={3.3792}
              />
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 p-8 rounded-xl text-center text-yellow-700">
                Enter Driver ID and Access Token above to enable simulator
              </div>
            )}
          </div>

          {/* Rider Live Tracking + Map */}
          <div className="lg:col-span-2">
            <h2 className="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">
              3. Rider Live Tracking
            </h2>

            {rideId && driverId && accessToken ? (
              <div className="space-y-6">
                {/* Rider Live Tracking Component */}
                <RiderLiveTracking
                  rideId={rideId}
                  driverId={driverId}
                  accessToken={accessToken}
                />

                {/* MapLibre Map */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 text-gray-700">Live Map View</h3>
                  <div className="bg-white rounded-xl shadow overflow-hidden border border-gray-200">
                    <MapTest />
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 p-8 rounded-xl text-center text-yellow-700">
                Enter Ride ID, Driver ID and Access Token above to enable live tracking + map
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;