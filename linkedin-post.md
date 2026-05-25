
---

## 📱 LinkedIn Post (Recruiter-Optimized)

# 🚀 I Built an Uber-Style Real-Time Dispatch System in 30 Days

After weeks of deep work on distributed systems, I'm excited to share my latest project: **A production-ready ride-hailing platform** that handles 1000+ concurrent users with <500ms latency.

## 📊 Technical Highlights
┌─────────────────────────────────────────────────────────┐
│ Real-time driver matching: Redis GEO → <50ms │
│ Live location tracking: WebSocket + 3s heartbeats │
│ ETA prediction: OSRM routing + Redis cache (50ms) │
│ Surge pricing: Dynamic zones, 1-min updates │
│ Horizontal scaling: 5 API + 3 WebSocket servers │
│ Load balancing: HAProxy with sticky sessions │
│ Database: PostgreSQL primary + 2 read replicas │
│ Monitoring: Prometheus + Grafana dashboards │
│ Load tested: 1000 riders + 500 drivers simultaneously │
└─────────────────────────────────────────────────────────┘
text


## 🏗️ System Architecture

**Client Layer**: React + MapLibre GL JS (free maps)

**Gateway**: Nginx/HAProxy (rate limiting, SSL termination)

**Application Layer**:
- 5x Node.js API servers (stateless, Express)
- 3x Socket.io WebSocket servers (Redis Pub/Sub)
- Background workers for ETA + surge updates

**Data Layer**:
- Redis Cluster: 3 masters + 3 slaves (GEO indexing)
- PostgreSQL: Primary (writes) + 2 replicas (reads)

## 📈 Performance Metrics (k6 Load Test)

| Metric | Result |
|--------|--------|
| Concurrent users | 1,500 (1k riders + 500 drivers) |
| p95 API latency | 487ms |
| Error rate | 1.8% |
| Driver match time | 1.2s avg |
| Ride success rate | 96.5% |
| WebSocket broadcast | <20ms |
| Database read/write split | 67% read replica usage |

## 🔧 Technical Decisions & Trade-offs

**Why Redis GEO over PostGIS?**
- PostGIS: 200-500ms queries at scale
- Redis GEO: <50ms, but limited to 10k drivers per node
- Solution: Redis cluster with sharding

**Why WebSocket + HTTP hybrid?**
- Pure HTTP: 500ms polling overhead
- Pure WebSocket: Connection limits
- Hybrid: HTTP for requests, WebSocket for updates

**Why OSRM over Google Maps?**
- Cost: Free vs $0.005/request
- Latency: 200ms vs 100ms (acceptable)
- Control: Self-hosted, no rate limits

**Why horizontal scaling without sticky sessions?**
- Sticky sessions complicate failover
- Solution: Redis Pub/Sub + shared session store

## 🎯 What I'd Do Differently for 1M Users

1. **Shard by city** - Each city gets dedicated Redis/PostgreSQL
2. **Kafka for event sourcing** - Replace Redis Pub/Sub for ride events
3. **Edge computing** - Deploy matching logic to Cloudflare Workers
4. **ML for ETA** - Replace OSRM with trained model
5. **InfluxDB for time-series** - Surge/ride analytics

## 🛠️ Tech Stack

Backend: Node.js + TypeScript
Real-time: Socket.io + Redis Pub/Sub
Database: PostgreSQL 15 + read replicas
Cache: Redis 7 Cluster (GEO indexing)
Routing: OSRM (self-hosted)
Maps: MapLibre GL JS (free tier)
Payments: Stripe + wallet system
Monitoring: Prometheus + Grafana
Load Testing: k6 (1000+ VUs)
Infrastructure: Docker + HAProxy
text


## 📂 Repository Structure

├── apps/
│ ├── api/ # Express server (5 instances)
│ ├── socket/ # WebSocket server (3 instances)
│ └── worker/ # Background workers
├── packages/
│ ├── auth/ # JWT + refresh tokens
│ ├── redis/ # GEO + Pub/Sub
│ ├── routing/ # OSRM + ETA caching
│ ├── surge/ # Dynamic pricing engine
│ └── payment/ # Stripe + wallet
├── tests/load/ # k6 performance tests
└── configs/
├── haproxy/ # Load balancer config
├── prometheus/ # Metrics collection
└── grafana/ # Dashboards
text


## 🔗 Live Demo

**[Watch 3-min Demo](https://youtu.be/your-demo-link)**
- 0:00 - Rider requests ride
- 0:45 - Driver receives notification
- 1:30 - Real-time tracking on map
- 2:15 - Surge pricing display
- 2:45 - Payment + receipt

**[GitHub Repository](https://github.com/yourusername/ride-hailing-system)**
- 200+ commits, clean architecture
- Comprehensive README + architecture diagram
- Load test results included

## 📊 Key Takeaways for Recruiters

**This project demonstrates:**

✅ **Distributed Systems** - Horizontal scaling, Redis cluster, read replicas
✅ **Real-time Engineering** - WebSockets, 3s heartbeats, Pub/Sub
✅ **Database Design** - GEO indexing, connection pooling, query routing
✅ **Performance Optimization** - Caching strategies, load testing (k6)
✅ **System Design** - Event-driven, stateless API, circuit breakers
✅ **DevOps** - Docker, HAProxy, Prometheus, Grafana, CI/CD
✅ **Payment Integration** - Stripe, wallet system, promo codes

## 🎓 What I Learned

**Hardest challenge**: Real-time ETA updates at scale
- OSRM took 200ms per request → too slow for 1000 users
- Solution: Redis cache with 1hr TTL + batch ETA for multiple drivers
- Result: 50ms for cached routes, 200ms for new routes

**Most valuable insight**: Design for failure
- Redis cluster has 3 masters + automatic failover
- Database read replicas take over if primary fails
- WebSocket servers reconnect automatically

## 📬 Open to Opportunities

I'm actively looking for **Senior Backend Engineer** or **Distributed Systems Engineer** roles where I can build real-time, high-scale systems.

**Tech focus**: Node.js/TypeScript, Redis, PostgreSQL, WebSockets, System Design

**Location**: Remote / [Your City]

**Email**: your.email@example.com

**GitHub**: github.com/yourusername

---

*Like this post? ♻️ Repost to help me reach the right opportunities!*

*#distributedsystems #realtimeengineering #nodejs #redis #systemdesign #backendengineering #ridehailing #opensource #buildinpublic*