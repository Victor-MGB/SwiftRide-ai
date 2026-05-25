import http from 'k6/http';
import { sleep } from 'k6';
import { config } from './config.js';

export let options = {
    stages: [
        { duration: '30s', target: 100 },   // Quick ramp
        { duration: '1m', target: 1000 },    // Spike to 1000
        { duration: '30s', target: 2000 },   // Spike to 2000
        { duration: '1m', target: 2000 },    // Hold at peak
        { duration: '30s', target: 0 },      // Ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<1000'], // Allow higher latency under stress
        http_req_failed: ['rate<0.05'],    // Allow 5% error rate
    },
};

export default function() {
    const endpoints = [
        '/api/health',
        '/api/surge/multiplier?lat=40.7128&lng=-74.0060',
        '/api/driver/nearby?lat=40.7128&lng=-74.0060&radius=5'
    ];
    
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    
    http.get(`${config.baseUrl}${endpoint}`, {
        tags: { name: 'stress_test' }
    });
    
    sleep(Math.random() * 0.5);
}