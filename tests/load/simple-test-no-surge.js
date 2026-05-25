import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
    vus: 10,
    duration: '30s',
};

export default function() {
    const BASE_URL = 'http://localhost:3001';
    
    // Login
    const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
        email: 'rider@test.com',
        password: 'password123'
    }), { headers: { 'Content-Type': 'application/json' } });
    
    if (loginRes.status !== 200) {
        return;
    }
    
    const token = JSON.parse(loginRes.body).accessToken;
    
    // Test health
    const healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, { 'health': (r) => r.status === 200 });
    
    // Test auth
    const meRes = http.get(`${BASE_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    check(meRes, { 'auth': (r) => r.status === 200 });
    
    // Test nearby drivers (working)
    const nearbyRes = http.get(
        `${BASE_URL}/api/rides/nearby-drivers?lat=40.7128&lng=-74.0060`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    check(nearbyRes, { 'nearby': (r) => r.status === 200 });
    
    sleep(1);
}