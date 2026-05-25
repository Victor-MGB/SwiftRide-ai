# Scaling Strategy for Ride-Hailing Platform

## Current Capacity
- **500 concurrent users** with <500ms p95 latency
- **1000 concurrent users** with <800ms p95 latency
- **2000 concurrent users** stress test with <5% error rate

## Vertical Scaling (First Level)

### API Server Optimization
```yaml
Node.js optimizations:
  - Cluster mode: Use all CPU cores
  - Memory limit: 2GB per instance
  - Event loop monitoring: Use `clinic` for profiling
  
Resource allocation:
  - CPU: 4 cores minimum
  - RAM: 8GB recommended
  - Network: 1Gbps