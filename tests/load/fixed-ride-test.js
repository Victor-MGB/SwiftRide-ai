import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
    vus: 5,  // Start with 5 users (not 1000)
    duration: '30s',
    thresholds: {
        http_req_failed: ['rate<0.1'],  // Allow 10% failure rate
        http_req_duration: ['p(95)<2000'], // 2 second max
    },
};

// Single test user (reuse same user)
const testUser = {
    email: 'test_rider@example.com',
    password: 'Test123!@#'
};

export default function() {
    // 1. Login (only once per VU)
    if (!__VU.loggedIn) {
        const loginPayload = JSON.stringify({
            email: testUser.email,
            password: testUser.password
        });
        
        const loginRes = http.post('http://localhost:3001/api/auth/login', loginPayload, {
            headers: { 'Content-Type': 'application/json' },
        });
        
        if (loginRes.status === 200) {
            const body = JSON.parse(loginRes.body);
            __VU.token = body.accessToken;
            __VU.loggedIn = true;
            console.log(`VU ${__VU} logged in successfully`);
        } else {
            console.error(`VU ${__VU} login failed: ${loginRes.status}`);
            return;
        }
    }
    
    // 2. Check surge multiplier (lightweight test)
    const surgeRes = http.get(
        'http://localhost:3001/api/surge/multiplier?lat=40.7128&lng=-74.0060',
        {
            headers: {
                'Authorization': `Bearer ${__VU.token}`
            }
        }
    );
    
    check(surgeRes, {
        'surge check status is 200': (r) => r.status === 200,
    });
    
    // 3. Request a ride
    const ridePayload = JSON.stringify({
        pickupLat: 40.7128,
        pickupLng: -74.0060,
        dropoffLat: 40.7580,
        dropoffLng: -73.9855
    });
    
    const rideRes = http.post('http://localhost:3001/api/rides/request', ridePayload, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${__VU.token}`
        },
    });
    
    check(rideRes, {
        'ride request status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    });
    
    if (rideRes.status === 200 || rideRes.status === 201) {
        const body = JSON.parse(rideRes.body);
        console.log(`Ride created: ${body.rideId}`);
    }
    
    sleep(1);
}