import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
    vus: 5,              // 5 virtual users
    duration: '30s',     // Run for 30 seconds
};

// Get a single token once (not per iteration)
let sharedToken = null;

function getAuthToken() {
    const loginPayload = JSON.stringify({
        email: 'loadtest@example.com',
        password: 'Test123!@#'
    });
    
    const loginRes = http.post('http://localhost:3001/api/auth/login', loginPayload, {
        headers: { 'Content-Type': 'application/json' },
    });
    
    if (loginRes.status === 200) {
        return JSON.parse(loginRes.body).accessToken;
    }
    return null;
}

// Setup - runs once before the test
export function setup() {
    console.log('Getting auth token...');
    const token = getAuthToken();
    if (!token) {
        console.error('Failed to get auth token!');
        return { token: null };
    }
    console.log('Token obtained successfully');
    return { token };
}

// Main test function
export default function(data) {
    const token = data.token;
    if (!token) {
        console.error('No valid token');
        return;
    }
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    
    // Test 1: Check surge multiplier (GET request)
    const surgeRes = http.get(
        'http://localhost:3001/api/surge/multiplier?lat=40.7128&lng=-74.0060',
        { headers }
    );
    
    check(surgeRes, {
        'surge multiplier endpoint works': (r) => r.status === 200,
    });
    
    // Test 2: Get nearby drivers (GET request)
    const nearbyRes = http.get(
        'http://localhost:3001/api/rides/nearby-drivers?lat=40.7128&lng=-74.0060&radius=5',
        { headers }
    );
    
    check(nearbyRes, {
        'nearby drivers endpoint works': (r) => r.status === 200,
    });
    
    // Small delay between requests
    sleep(0.5);
}

// Teardown - runs once after the test
export function teardown(data) {
    console.log(`Load test completed. ${data.token ? 'Token was valid' : 'No valid token'}`);
}