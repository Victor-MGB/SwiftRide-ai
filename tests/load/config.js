export const config = {
    // Base URLs
    baseUrl: __ENV.BASE_URL || 'http://localhost:3001',
    wsUrl: __ENV.WS_URL || 'ws://localhost:3002',
    
    // Test configuration
    stages: [
        { duration: '1m', target: 50 },   // Ramp up to 50 users
        { duration: '2m', target: 200 },  // Ramp to 200 users
        { duration: '3m', target: 500 },  // Ramp to 500 users
        { duration: '4m', target: 1000 }, // Ramp to 1000 users
        { duration: '5m', target: 1000 }, // Stay at 1000 users
        { duration: '2m', target: 0 },    // Ramp down
    ],
    
    // Thresholds
    thresholds: {
        http_req_duration: ['p(95)<500'], // 95% of requests < 500ms
        http_req_failed: ['rate<0.01'],   // Less than 1% error rate
        checks: ['rate>0.95'],             // 95% success rate
    },
    
    // Environment
    environment: {
        TEST_MODE: 'true',
        LOG_LEVEL: 'error'
    }
};