import client from 'prom-client';
import express from 'express';

// Create Prometheus registry
const register = new client.Registry();

// Add default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
export const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 10]
});

export const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
});

export const activeDriversGauge = new client.Gauge({
    name: 'active_drivers_total',
    help: 'Number of active drivers online'
});

export const activeRidesGauge = new client.Gauge({
    name: 'active_rides_total',
    help: 'Number of active rides'
});

export const rideRequestDuration = new client.Histogram({
    name: 'ride_request_duration_seconds',
    help: 'Duration of ride request processing',
    buckets: [0.5, 1, 2, 5, 10]
});

export const surgeMultiplierGauge = new client.Gauge({
    name: 'surge_multiplier',
    help: 'Current surge multiplier by zone',
    labelNames: ['zone']
});

export const websocketConnectionsGauge = new client.Gauge({
    name: 'websocket_active_connections',
    help: 'Number of active WebSocket connections'
});

export const redisOperationDuration = new client.Histogram({
    name: 'redis_operation_duration_seconds',
    help: 'Duration of Redis operations',
    labelNames: ['operation'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1]
});

export const dbQueryDuration = new client.Histogram({
    name: 'db_query_duration_seconds',
    help: 'Duration of database queries',
    labelNames: ['query_type'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1]
});

// Middleware to collect metrics
export const metricsMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route?.path || req.path;
        
        httpRequestDuration.labels(req.method, route, res.statusCode.toString()).observe(duration);
        httpRequestsTotal.labels(req.method, route, res.statusCode.toString()).inc();
    });
    
    next();
};

// Metrics endpoint
export const metricsEndpoint = async (req: express.Request, res: express.Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
};

// Update metrics periodically
export async function updateMetrics() {
    const { redis } = await import('../../../../packages/redis/client');
    const { DriverTrackingService } = await import('../../../../packages/redis/driver-tracking');
    const { ZoneManager } = await import('../../../../packages/zones/zone.manager');
    
    // Update active drivers
    const activeDrivers = await redis.zcard('drivers:online');
    activeDriversGauge.set(activeDrivers);
    
    // Update active rides
    const rideKeys = await redis.keys('ride:*');
    let activeRides = 0;
    for (const key of rideKeys) {
        const status = await redis.hget(key, 'status');
        if (status && ['accepted', 'arrived', 'started'].includes(status)) {
            activeRides++;
        }
    }
    activeRidesGauge.set(activeRides);
    
    // Update surge multipliers
    const zones = await ZoneManager.getAllZones();
    zones.forEach(zone => {
        surgeMultiplierGauge.labels(zone.name).set(zone.multiplier);
    });
}

// Start metrics update interval
setInterval(updateMetrics, 10000);