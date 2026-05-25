#  Real-Time Ride-Hailing Dispatch System

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Redis](https://img.shields.io/badge/Redis-7.x-red.svg)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue.svg)](https://www.postgresql.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.x-black.svg)](https://socket.io/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A **production-ready, horizontally scalable** ride-hailing dispatch system that matches riders with nearby drivers in real-time, with dynamic surge pricing, live tracking, and complete payment integration.

##  Why This Project Stands Out

This isn't just another Uber clone. It demonstrates **real distributed systems engineering**:

| Feature | Implementation | Why It Matters |
|---------|---------------|----------------|
| **Driver Matching** | Redis GEO + Lua scripts | <50ms query time, atomic operations |
| **Real-time Updates** | Socket.io + Redis Pub/Sub | Cross-server broadcast, <20ms latency |
| **ETA Prediction** | OSRM routing + Redis cache | 200ms fresh, 50ms cached |
| **Surge Pricing** | Geospatial zones + 1-min updates | Dynamic pricing based on supply/demand |
| **Scale** | Horizontal scaling + load balancing | 1000+ concurrent users verified |

## Architecture
┌─────────────────────────────────────────────────────────────────┐
│ Client Layer │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │ Rider │ │ Driver │ │ Admin │ │ Maps │ │
│ │ Web │ │ Web │ │ Web │ │ (MapLibre)│ │
│ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
└───────┼─────────────┼─────────────┼─────────────┼──────────────┘
│ │ │ │
▼ ▼ ▼ ▼
┌─────────────────────────────────────────────────────────────────┐
│ Gateway Layer │
│ Nginx/HAProxy Load Balancer │
│ (SSL termination, rate limiting) │
└─────────────────────────────┬───────────────────────────────────┘
│
┌─────────────────────┼─────────────────────┐
▼ ▼ ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ API Server │ │ API Server │ │ API Server │
│ (Express) │ │ (Express) │ │ (Express) │
│ Port 3001 │ │ Port 3001 │ │ Port 3001 │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘
│ │ │
└────────────────────┼────────────────────┘
│
┌────────────────────┼────────────────────┐
▼ ▼ ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ WebSocket │ │ WebSocket │ │ WebSocket │
│ Server (x3) │ │ Server (x3) │ │ Server (x3) │
│ Socket.io │ │ Socket.io │ │ Socket.io │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘
│ │ │
└────────────────────┼────────────────────┘
│
┌──────────────┼──────────────┐
▼ ▼ ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Redis │ │ Redis │ │ Redis │
│ Cluster │ │ Cluster │ │ Cluster │
│ (3M+3S) │ │ (3M+3S) │ │ (3M+3S) │
└──────────┘ └──────────┘ └──────────┘
│
┌──────────────┼──────────────┐
▼ ▼ ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│PostgreSQL│ │PostgreSQL│ │PostgreSQL│
│ Primary │ │ Replica 1│ │ Replica 2│
│ (Write) │ │ (Read) │ │ (Read) │
└──────────┘ └──────────┘ └──────────┘


##  Performance Metrics

| Metric | Value | Test Condition |
|--------|-------|----------------|
| Driver location update | <10ms | Redis GEOADD |
| Nearest driver query | <50ms | Redis GEORADIUS |
| Ride request → match | <100ms | With available driver |
| WebSocket broadcast | <20ms | Cross-server |
| ETA calculation (cached) | <50ms | Redis cache hit |
| ETA calculation (OSRM) | <200ms | Fresh route |
| **Load test** | **1000 concurrent users** | **<500ms p95** |
| **Stress test** | **2000 concurrent users** | **<5% error rate** |

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/ride-hailing-system.git
cd ride-hailing-system

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your values

# Start databases
docker-compose up -d postgres redis

# Run migrations
npm run db:migrate

# Start all services (4 terminals or use concurrently)
npm run dev:api      # Terminal 1: API server on port 3001
npm run dev:socket   # Terminal 2: WebSocket on port 3002
npm run dev:worker   # Terminal 3: Background worker
npm run dev:surge-worker # Terminal 4: Surge pricing worker

# Or run all at once
npm run dev:all


# Quick system test
./scripts/quick-test.sh

# Load test (1000 users)
k6 run tests/load/full-scale-test.js

# Health check
./scripts/final-health-check.sh


POST /api/auth/signup/rider     # Create rider account
POST /api/auth/signup/driver    # Create driver account
POST /api/auth/login            # Login (returns JWT)
POST /api/auth/refresh          # Refresh access token
POST /api/auth/logout           # Logout


POST   /api/rides/request       # Request a ride
GET    /api/rides/:id/status    # Get ride status
POST   /api/rides/:id/cancel    # Cancel ride
POST   /api/rides/:id/accept    # Driver accepts ride
GET    /api/rides/nearby-drivers # Find nearby drivers


POST   /api/driver/location/update  # Update GPS location
POST   /api/driver/status/set       # Set online/offline
GET    /api/driver/status           # Get current status


GET    /api/surge/multiplier        # Get current surge multiplier
GET    /api/surge/zones             # Get all zones with surge
POST   /api/surge/admin/override    # Admin manual override


POST   /api/payment/pay             # Process payment
GET    /api/payment/wallet          # Get wallet balance
POST   /api/payment/wallet/add      # Add funds to wallet
POST   /api/payment/promo/apply     # Apply promo code


Horizontal Scaling
Start Scaling Infrastructure
bash

# Start all scaled services (5 API, 3 WebSocket, Redis cluster)
npm run scale:up

# Scale API servers
npm run scale:api

# Scale WebSocket servers
npm run scale:socket

# Check HAProxy stats
open http://localhost:8404/stats


Load Balancing Configuration
nginx

upstream api_cluster {
    least_conn;
    server api-1:3001 max_fails=3;
    server api-2:3001 max_fails=3;
    server api-3:3001 max_fails=3;
}

upstream socket_cluster {
    ip_hash;  # Sticky sessions for WebSocket
    server socket-1:3002;
    server socket-2:3002;
    server socket-3:3002;
}

📈 Monitoring
Prometheus Metrics
bash

# Access Prometheus
open http://localhost:9090

# Key metrics to query:
- active_drivers_total
- rate(http_requests_total[1m])
- histogram_quantile(0.95, http_request_duration_seconds)

Grafana Dashboard
bash

# Access Grafana
open http://localhost:3000
# Login: admin / admin

# Import dashboard ID: ride-hailing-prod

Key Dashboards

    Real-time Metrics: Active drivers, rides, surge zones

    Performance: API latency, error rates, throughput

    Business Metrics: Ride completion rate, revenue, avg ETA

    Infrastructure: CPU, memory, database connections

🧪 Load Testing
Run Load Tests
bash

# Smoke test (10 users, 30 sec)
k6 run tests/load/ride-request.test.js --duration 30s --vus 10

# Full load test (1000 riders + 500 drivers)
./scripts/run-full-scale-test.sh

# Stress test (spike to 2000 users)
k6 run tests/load/stress-test.js

Sample Results
text

✓ ride_success_rate: 96.5%
✓ p95_latency: 487ms
✓ error_rate: 1.8%
✓ total_requests: 45,234

📁 Project Structure
text

├── apps/
│   ├── api/           # Express API server
│   ├── socket/        # WebSocket server
│   ├── web/           # React frontend
│   └── worker/        # Background workers
├── packages/
│   ├── auth/          # JWT authentication
│   ├── database/      # PostgreSQL models
│   ├── redis/         # Redis client + GEO
│   ├── routing/       # OSRM + ETA caching
│   ├── surge/         # Surge pricing engine
│   ├── ride-matching/ # Driver matching algo
│   └── payment/       # Stripe integration
├── tests/
│   └── load/          # k6 load tests
├── configs/
│   ├── nginx/         # Load balancer config
│   ├── haproxy/       # HAProxy config
│   ├── prometheus/    # Monitoring config
│   └── grafana/       # Dashboard config
└── docs/
    ├── architecture.md
    └── scaling-strategy.md

🛠️ Technology Stack
Layer	Technology	Purpose
Backend	Node.js + TypeScript	Type-safe, event-driven
Real-time	Socket.io + Redis Pub/Sub	Bidirectional communication
Database	PostgreSQL 15	ACID compliance, ride history
Cache	Redis 7 (Cluster)	GEO indexing, sessions, rate limiting
Routing	OSRM	Open-source route calculation
Maps	MapLibre GL JS	Free, customizable maps
Payments	Stripe	Payment processing
Monitoring	Prometheus + Grafana	Metrics + visualization
Load Testing	k6	Performance validation
Container	Docker + Docker Compose	Consistent environments
Load Balancer	HAProxy / Nginx	Traffic distribution
🔧 Environment Variables
env

# Server
PORT=3001
SOCKET_PORT=3002
NODE_ENV=production

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=uber
DB_PASSWORD=uber123
DB_NAME=uber_clone

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
ACCESS_TOKEN_SECRET=your-secret-key
REFRESH_TOKEN_SECRET=your-refresh-key

# Stripe
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# MapLibre
MAPLIBRE_ACCESS_TOKEN=your-token

🚨 Error Handling
Error Code	Description	Handling
400	Bad Request	Validation error
401	Unauthorized	Invalid/expired token
403	Forbidden	Insufficient permissions
404	Not Found	Resource doesn't exist
409	Conflict	Race condition (double booking)
429	Too Many Requests	Rate limit exceeded
500	Internal Error	Fallback + logging
🤝 Contributing

    Fork the repository

    Create feature branch (git checkout -b feature/amazing)

    Commit changes (git commit -m 'Add amazing feature')

    Push to branch (git push origin feature/amazing)

    Open Pull Request

📄 License

MIT © Victor
🙏 Acknowledgments

    OpenStreetMap for free map data

    OSRM team for routing engine

    Redis Labs for GEO implementation

    Stripe for payment infrastructure

📞 Contact & Support

    GitHub Issues: Create an issue

    Email: mgbemenaosonduv@gmail.com

    LinkedIn: https://www.linkedin.com/in/victor-osondu777/