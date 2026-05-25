import http from 'k6/http';
import { check, sleep } from 'k6';
import { config } from './config.js';
import { Trend, Rate, Counter } from 'k6/metrics';

// Custom metrics
const rideRequestDuration = new Trend('ride_request_duration', true);
const matchSuccessRate = new Rate('match_success_rate');
const activeRides = new Counter('active_rides');

export let options = {
    stages: config.stages,
    thresholds: config.thresholds,
    ext: {
        loadimpact: {
            projectID: 123456,
            name: 'Ride-Hailing Load Test'
        }
    }
};

// Test data
const pickupLocations = [
    { lat: 40.7128, lng: -74.0060 }, // Downtown
    { lat: 40.7580, lng: -73.9855 }, // Times Square
    { lat: 40.7489, lng: -73.9680 }, // Empire State
    { lat: 40.7851, lng: -73.9683 }, // Central Park
    { lat: 40.7075, lng: -74.0113 }, // Financial District
];

const dropoffLocations = [
    { lat: 40.7580, lng: -73.9855 },
    { lat: 40.7128, lng: -74.0060 },
    { lat: 40.6413, lng: -73.7781 }, // JFK Airport
    { lat: 40.6892, lng: -74.0445 }, // Statue of Liberty
];

// Helper functions
function getRandomLocation(locations) {
    return locations[Math.floor(Math.random() * locations.length)];
}

function generateTestUser(index) {
    return {
        email: `test_user_${index}@test.com`,
        phone: `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,
        fullName: `Test User ${index}`,
        password: 'Test123!@#'
    };
}

// Main test function
export default function() {
    const userId = `user_${__VU}_${__ITER}`;
    let accessToken = null;
    
    // 1. User Signup or Login
    const signupPayload = JSON.stringify(generateTestUser(__VU));
    const signupResponse = http.post(`${config.baseUrl}/api/auth/signup/rider`, signupPayload, {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'signup' }
    });
    
    if (signupResponse.status === 201) {
        const responseBody = JSON.parse(signupResponse.body);
        accessToken = responseBody.accessToken;
    } else {
        // Try login if signup fails (user exists)
        const loginPayload = JSON.stringify({
            email: `test_user_${__VU}@test.com`,
            password: 'Test123!@#'
        });
        const loginResponse = http.post(`${config.baseUrl}/api/auth/login`, loginPayload, {
            headers: { 'Content-Type': 'application/json' },
            tags: { name: 'login' }
        });
        
        if (loginResponse.status === 200) {
            const responseBody = JSON.parse(loginResponse.body);
            accessToken = responseBody.accessToken;
        }
    }
    
    if (!accessToken) {
        console.error('Failed to authenticate user');
        return;
    }
    
    // 2. Set driver online (simulate driver available)
    if (__VU % 2 === 0) {
        const driverLoginPayload = JSON.stringify({
            email: `driver_${__VU}@test.com`,
            password: 'Test123!@#'
        });
        const driverLoginResponse = http.post(`${config.baseUrl}/api/auth/login`, driverLoginPayload, {
            headers: { 'Content-Type': 'application/json' },
            tags: { name: 'driver_login' }
        });
        
        if (driverLoginResponse.status === 200) {
            const driverData = JSON.parse(driverLoginResponse.body);
            const driverToken = driverData.accessToken;
            
            // Update driver location
            const location = getRandomLocation(pickupLocations);
            const locationPayload = JSON.stringify({
                latitude: location.lat,
                longitude: location.lng,
                status: 'online'
            });
            http.post(`${config.baseUrl}/api/driver/location/update`, locationPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${driverToken}`
                },
                tags: { name: 'driver_location' }
            });
        }
    }
    
    // 3. Request a ride
    const rideStart = Date.now();
    
    const ridePayload = JSON.stringify({
        pickupLat: getRandomLocation(pickupLocations).lat,
        pickupLng: getRandomLocation(pickupLocations).lng,
        dropoffLat: getRandomLocation(dropoffLocations).lat,
        dropoffLng: getRandomLocation(dropoffLocations).lng,
        rideType: 'standard'
    });
    
    const rideResponse = http.post(`${config.baseUrl}/api/rides/request`, ridePayload, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        tags: { name: 'ride_request' }
    });
    
    const rideDuration = Date.now() - rideStart;
    rideRequestDuration.add(rideDuration);
    
    // 4. Check response
    const success = check(rideResponse, {
        'ride request successful': (r) => r.status === 201,
        'ride ID returned': (r) => JSON.parse(r.body).rideId !== undefined,
        'response time < 500ms': () => rideDuration < 500
    });
    
    matchSuccessRate.add(success);
    
    if (success) {
        const rideData = JSON.parse(rideResponse.body);
        activeRides.add(1);
        
        // 5. Poll ride status (simulate waiting)
        if (rideData.rideId) {
            let status = 'searching';
            let attempts = 0;
            
            while (status === 'searching' && attempts < 10) {
                sleep(1);
                attempts++;
                
                const statusResponse = http.get(`${config.baseUrl}/api/rides/${rideData.rideId}/status`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                    tags: { name: 'ride_status' }
                });
                
                if (statusResponse.status === 200) {
                    const statusData = JSON.parse(statusResponse.body);
                    status = statusData.status;
                }
            }
        }
    }
    
    // 6. Get surge multiplier
    const location = getRandomLocation(pickupLocations);
    http.get(`${config.baseUrl}/api/surge/multiplier?lat=${location.lat}&lng=${location.lng}`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        },
        tags: { name: 'surge_check' }
    });
    
    // 7. Simulate user thinking time
    sleep(Math.random() * 3 + 1);
}

// Setup function - runs once before test
export function setup() {
    console.log('Starting ride-hailing load test...');
    
    // Create test drivers
    const driverCount = 100;
    for (let i = 0; i < driverCount; i++) {
        const driverPayload = JSON.stringify({
            email: `driver_${i}@test.com`,
            phone: `+1${1000000000 + i}`,
            fullName: `Test Driver ${i}`,
            password: 'Test123!@#',
            vehicleModel: 'Test Vehicle',
            vehiclePlate: `TST${i}`,
            vehicleColor: 'Black',
            licensePlate: `LIC${i}`
        });
        
        http.post(`${config.baseUrl}/api/auth/signup/driver`, driverPayload, {
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    return { driverCount };
}

// Teardown function - runs once after test
export function teardown(data) {
    console.log(`Load test completed. ${data.driverCount} drivers created.`);
}

