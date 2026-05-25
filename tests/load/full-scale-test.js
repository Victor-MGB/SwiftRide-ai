import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// Custom metrics
const rideSuccessRate = new Rate('ride_success_rate');
const driverMatchTime = new Trend('driver_match_time', true);
const surgeResponseTime = new Trend('surge_response_time', true);
const activeRiders = new Counter('active_riders');
const activeDrivers = new Counter('active_drivers');

export let options = {
    scenarios: {
        // Rider scenario: 1000 concurrent riders
        riders: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 250 },   // Ramp to 250 riders
                { duration: '3m', target: 500 },   // Ramp to 500 riders
                { duration: '5m', target: 1000 },  // Ramp to 1000 riders
                { duration: '5m', target: 1000 },  // Hold at 1000
                { duration: '2m', target: 0 },     // Ramp down
            ],
            exec: 'riderScenario',
            tags: { scenario: 'riders' }
        },
        
        // Driver scenario: 500 concurrent drivers
        drivers: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 125 },
                { duration: '3m', target: 250 },
                { duration: '5m', target: 500 },
                { duration: '5m', target: 500 },
                { duration: '2m', target: 0 },
            ],
            exec: 'driverScenario',
            startTime: '30s',  // Start drivers 30 seconds after riders
            tags: { scenario: 'drivers' }
        }
    },
    
    thresholds: {
        http_req_duration: ['p(95)<500', 'p(99)<1000'],
        http_req_failed: ['rate<0.02'],
        ride_success_rate: ['rate>0.95'],
        driver_match_time: ['p(95)<2000'],
        surge_response_time: ['p(95)<100'],
    },
};

// Test data
const PICKUP_LOCATIONS = [
    { lat: 40.7128, lng: -74.0060, name: 'Downtown' },
    { lat: 40.7580, lng: -73.9855, name: 'Times Square' },
    { lat: 40.7489, lng: -73.9680, name: 'Empire State' },
    { lat: 40.7851, lng: -73.9683, name: 'Central Park' },
    { lat: 40.7075, lng: -74.0113, name: 'Financial District' },
    { lat: 40.6413, lng: -73.7781, name: 'JFK Airport' },
    { lat: 40.6892, lng: -74.0445, name: 'Statue of Liberty' },
    { lat: 40.7624, lng: -73.9738, name: 'Columbus Circle' },
    { lat: 40.7549, lng: -73.9840, name: 'Port Authority' },
    { lat: 40.6928, lng: -74.0133, name: 'Brooklyn Bridge' },
];

const DROPOFF_LOCATIONS = [
    { lat: 40.7580, lng: -73.9855 },
    { lat: 40.7128, lng: -74.0060 },
    { lat: 40.6413, lng: -73.7781 },
    { lat: 40.6892, lng: -74.0445 },
    { lat: 40.7624, lng: -73.9738 },
];

// Helper functions
function randomPickup() {
    return PICKUP_LOCATIONS[Math.floor(Math.random() * PICKUP_LOCATIONS.length)];
}

function randomDropoff() {
    return DROPOFF_LOCATIONS[Math.floor(Math.random() * DROPOFF_LOCATIONS.length)];
}

function randomPhone() {
    return `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
}

// Rider scenario
export function riderScenario() {
    const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
    const userId = `rider_${__VU}_${__ITER}`;
    
    group('Rider Flow', function() {
        // 1. Signup/Login
        let token = null;
        let rideId = null;
        
        const signupPayload = JSON.stringify({
            email: `${userId}@test.com`,
            phone: randomPhone(),
            fullName: `Test Rider ${__VU}`,
            password: 'Test123!@#'
        });
        
        const signupRes = http.post(`${BASE_URL}/api/auth/signup/rider`, signupPayload, {
            headers: { 'Content-Type': 'application/json' },
            tags: { name: 'signup' }
        });
        
        if (signupRes.status === 201) {
            token = JSON.parse(signupRes.body).accessToken;
        } else {
            // Login if exists
            const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
                email: `${userId}@test.com`,
                password: 'Test123!@#'
            }), { headers: { 'Content-Type': 'application/json' } });
            
            if (loginRes.status === 200) {
                token = JSON.parse(loginRes.body).accessToken;
            }
        }
        
        if (!token) {
            console.error(`Rider ${userId} authentication failed`);
            return;
        }
        
        activeRiders.add(1);
        
        // 2. Check nearby drivers
        const pickup = randomPickup();
        const nearbyRes = http.get(
            `${BASE_URL}/api/rides/nearby-drivers?lat=${pickup.lat}&lng=${pickup.lng}&radius=5`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        
        check(nearbyRes, {
            'nearby drivers endpoint works': (r) => r.status === 200,
        });
        
        // 3. Check surge pricing
        const surgeStart = Date.now();
        const surgeRes = http.get(
            `${BASE_URL}/api/surge/multiplier?lat=${pickup.lat}&lng=${pickup.lng}`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        surgeResponseTime.add(Date.now() - surgeStart);
        
        let surgeMultiplier = 1.0;
        if (surgeRes.status === 200) {
            surgeMultiplier = JSON.parse(surgeRes.body).multiplier;
        }
        
        // 4. Request a ride
        const matchStart = Date.now();
        const dropoff = randomDropoff();
        const ridePayload = JSON.stringify({
            pickupLat: pickup.lat,
            pickupLng: pickup.lng,
            dropoffLat: dropoff.lat,
            dropoffLng: dropoff.lng,
            rideType: 'standard'
        });
        
        const rideRes = http.post(`${BASE_URL}/api/rides/request`, ridePayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            tags: { name: 'ride_request' }
        });
        
        const matchTime = Date.now() - matchStart;
        driverMatchTime.add(matchTime);
        
        const rideSuccess = check(rideRes, {
            'ride request successful': (r) => r.status === 201,
        });
        
        rideSuccessRate.add(rideSuccess);
        
        if (rideSuccess) {
            const rideData = JSON.parse(rideRes.body);
            rideId = rideData.rideId;
            
            // 5. Poll ride status
            let status = 'searching';
            let attempts = 0;
            
            while (status === 'searching' && attempts < 15) {
                sleep(1);
                attempts++;
                
                const statusRes = http.get(`${BASE_URL}/api/rides/${rideId}/status`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    tags: { name: 'ride_status_poll' }
                });
                
                if (statusRes.status === 200) {
                    const statusData = JSON.parse(statusRes.body);
                    status = statusData.status;
                }
            }
            
            // 6. Cancel if still searching
            if (status === 'searching') {
                http.post(`${BASE_URL}/api/rides/${rideId}/cancel`, 
                    JSON.stringify({ reason: 'Load test timeout' }),
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
            }
        }
        
        // 7. Simulate waiting
        sleep(Math.random() * 5 + 2);
    });
}

// Driver scenario
export function driverScenario() {
    const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
    const driverId = `driver_${__VU}_${__ITER}`;
    let token = null;
    let isOnline = false;
    let currentLat = 40.7128;
    let currentLng = -74.0060;
    
    group('Driver Flow', function() {
        // 1. Signup/Login
        const signupPayload = JSON.stringify({
            email: `${driverId}@test.com`,
            phone: randomPhone(),
            fullName: `Test Driver ${__VU}`,
            password: 'Test123!@#',
            vehicleModel: 'Test Vehicle',
            vehiclePlate: `TST${__VU}`,
            vehicleColor: 'Black',
            licensePlate: `LIC${__VU}`
        });
        
        const signupRes = http.post(`${BASE_URL}/api/auth/signup/driver`, signupPayload, {
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (signupRes.status === 201) {
            token = JSON.parse(signupRes.body).accessToken;
            
            // Approve driver (admin action - simplified for test)
            // In production, would need admin token
        } else {
            const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
                email: `${driverId}@test.com`,
                password: 'Test123!@#'
            }), { headers: { 'Content-Type': 'application/json' } });
            
            if (loginRes.status === 200) {
                token = JSON.parse(loginRes.body).accessToken;
            }
        }
        
        if (!token) {
            console.error(`Driver ${driverId} authentication failed`);
            return;
        }
        
        activeDrivers.add(1);
        
        // 2. Go online
        const onlineRes = http.post(`${BASE_URL}/api/driver/status/set`, 
            JSON.stringify({
                newStatus: 'online',
                latitude: currentLat,
                longitude: currentLng
            }),
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        
        isOnline = onlineRes.status === 200;
        
        if (isOnline) {
            // 3. Simulate movement (update location every 5 seconds)
            const updates = 10; // 50 seconds of movement
            for (let i = 0; i < updates; i++) {
                // Simulate driving towards pickup
                currentLat += (Math.random() - 0.5) * 0.001;
                currentLng += (Math.random() - 0.5) * 0.001;
                
                http.post(`${BASE_URL}/api/driver/location/update`,
                    JSON.stringify({
                        latitude: currentLat,
                        longitude: currentLng,
                        status: 'online'
                    }),
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                
                sleep(5);
            }
        }
        
        // 4. Go offline
        http.post(`${BASE_URL}/api/driver/status/set`,
            JSON.stringify({ newStatus: 'offline' }),
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
    });
}

// Setup - runs once before all scenarios
export function setup() {
    console.log('=== Starting Full-Scale Load Test ===');
    console.log(`Target: 1000 concurrent riders + 500 concurrent drivers`);
    console.log(`Base URL: ${__ENV.BASE_URL || 'http://localhost:3001'}`);
    
    // Verify system is ready
    const healthCheck = http.get(`${__ENV.BASE_URL || 'http://localhost:3001'}/health`);
    if (healthCheck.status !== 200) {
        console.error('❌ System not ready!');
        return { ready: false };
    }
    
    console.log('✅ System ready');
    return { ready: true, startTime: Date.now() };
}

// Teardown - runs once after all scenarios
export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000;
    console.log('\n=== Load Test Completed ===');
    console.log(`Duration: ${duration.toFixed(0)} seconds`);
    console.log(`Status: ${data.ready ? '✅ Successful' : '❌ Failed'}`);
    
    console.log('\n📊 Key Metrics:');
    console.log(`- Ride Success Rate: ${rideSuccessRate.values.rate || 'N/A'}`);
    console.log(`- Avg Driver Match Time: ${driverMatchTime.values.avg || 'N/A'}ms`);
    console.log(`- Surge Response Time: ${surgeResponseTime.values.avg || 'N/A'}ms`);
}