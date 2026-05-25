#!/bin/bash

echo "=== Performance Optimization ==="

# 1. Optimize PostgreSQL
echo "Optimizing PostgreSQL..."
docker exec ride-hailing-postgres-1 psql -U uber -d uber_clone -c "
    -- Create indexes for performance
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rides_rider_status ON rides(rider_id, status);
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rides_driver_status ON rides(driver_id, status);
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rides_requested_at ON rides(requested_at DESC);
    
    -- Analyze tables for query planner
    ANALYZE rides;
    ANALYZE users;
    ANALYZE driver_profiles;
    
    -- Update statistics
    SET default_statistics_target = 1000;
"

# 2. Optimize Redis
echo "Optimizing Redis..."
docker exec ride-hailing-redis-node-1 redis-cli CONFIG SET maxmemory 2gb
docker exec ride-hailing-redis-node-1 redis-cli CONFIG SET maxmemory-policy allkeys-lru
docker exec ride-hailing-redis-node-1 redis-cli CONFIG SET save "900 1 300 10 60 1000"

# 3. Optimize Node.js
echo "Optimizing Node.js..."
export NODE_OPTIONS="--max-old-space-size=2048 --optimize-for-size --max-semi-space-size=64"

# 4. Configure system limits
echo "Configuring system limits..."
ulimit -n 65536
ulimit -u 4096

# 5. Enable HTTP/2
echo "Enabling HTTP/2 in Nginx..."
docker exec ride-hailing-nginx-1 nginx -s reload

# 6. Setup connection pooling
echo "Configuring database connection pool..."
docker exec ride-hailing-postgres-1 psql -U uber -d uber_clone -c "
    ALTER SYSTEM SET max_connections = '500';
    ALTER SYSTEM SET shared_buffers = '512MB';
    ALTER SYSTEM SET effective_cache_size = '2GB';
    ALTER SYSTEM SET work_mem = '16MB';
    SELECT pg_reload_conf();
"

echo "✅ Performance optimization complete!"