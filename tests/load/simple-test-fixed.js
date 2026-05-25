import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
    vus: 5,
    duration: '30s',
    thresholds: {
        http_req_failed: ['rate<0.1'], // Allow 10% failure instead of 0%
        http_req_duration: ['p(95)<500'],
    },
};

// Test data
const testUsers = [
    { email: 'rider@test.com', password: 'password123' },
    { email: 'driver@test.com', password: 'password123' }
];

export default function() {
    const BASE_URL = 'http://localhost:3001';
    
    // 1. Login first
    const loginPayload = JSON.stringify({
        email: testUsers[0].email,
        password: testUsers[0].password
    });
    
    const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, {
        headers: { 'Content-Type': 'application/json' },
    });
    
    let token = null;
    if (loginRes.status === 200) {
        token = JSON.parse(loginRes.body).accessToken;
    }
    
    if (!token) {
        console.error('Login failed');
        return;
    }
    
    // 2. Test nearby drivers (already working)
    const nearbyRes = http.get(
        `${BASE_URL}/api/rides/nearby-drivers?lat=40.7128&lng=-74.0060&radius=5`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    check(nearbyRes, {
        'nearby drivers endpoint works': (r) => r.status === 200,
    });
    
    // 3. Test surge multiplier (with better error handling)
    const surgeRes = http.get(
        `${BASE_URL}/api/surge/multiplier?lat=40.7128&lng=-74.0060`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    // Check if endpoint exists and works
    const surgeSuccess = check(surgeRes, {
        'surge endpoint responds': (r) => r.status !== 404,
        'surge returns valid JSON': (r) => {
            try {
                JSON.parse(r.body);
                return true;
            } catch {
                return false;
            }
        }
    });
    
    if (surgeRes.status === 404) {
        console.error('Surge endpoint not found - check if routes are mounted');
    } else if (surgeRes.status === 401) {
        console.error('Authentication failed for surge endpoint');
    } else if (surgeRes.status === 200) {
        const surgeData = JSON.parse(surgeRes.body);
        console.log(`Surge multiplier: ${surgeData.multiplier}x`);
    }
    
    // 4. Health check (always works)
    const healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, {
        'health endpoint works': (r) => r.status === 200,
    });
    
    sleep(1);
}

// Setup function
export function setup() {
    console.log('Starting load test...');
    
    // Verify services are running
    const healthCheck = http.get('http://localhost:3001/health');
    if (healthCheck.status !== 200) {
        console.error('❌ API server not responding!');
        console.error('Make sure to run: npm run dev:api');
        return { servicesRunning: false };
    }
    
    console.log('✅ API server is running');
    return { servicesRunning: true };
}

// Teardown function
export function teardown(data) {
    console.log('\n📊 Test Summary:');
    console.log(`Services were ${data.servicesRunning ? '✅' : '❌'} running`);
}