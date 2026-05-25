#!/bin/bash

echo " FINAL SYSTEM HEALTH CHECK"
echo "============================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check Docker
echo -n "Docker: "
if docker ps &> /dev/null; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
    exit 1
fi

# Check PostgreSQL
echo -n "PostgreSQL: "
if docker exec swiftride-ai-postgres-1 psql -U uber -d uber_clone -c "SELECT 1" &> /dev/null; then
    echo -e "${GREEN}✓ Connected${NC}"
else
    echo -e "${YELLOW}⚠ Not running (start with: docker-compose up -d postgres)${NC}"
fi

# Check Redis
echo -n "Redis: "
if docker exec swiftride-ai-redis-1   redis-cli ping &> /dev/null; then
    echo -e "${GREEN}✓ Connected${NC}"
else
    echo -e "${YELLOW}⚠ Not running (start with: docker-compose up -d redis)${NC}"
fi

# Check API
echo -n "API Server (Port 3001): "
if curl -s http://localhost:3001/health &> /dev/null; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${YELLOW}⚠ Not running (start with: npm run dev:api)${NC}"
fi

# Check WebSocket
echo -n "WebSocket (Port 3002): "
if curl -s http://localhost:3002/health &> /dev/null; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${YELLOW}⚠ Not running (start with: npm run dev:socket)${NC}"
fi

echo ""
echo " SYSTEM STATUS SUMMARY"
echo "========================"

# Count active drivers in Redis
DRIVER_COUNT=$(docker exec swiftride-ai-redis-1 redis-cli ZCARD drivers:online 2>/dev/null || echo "0")
echo "Active Drivers Online: $DRIVER_COUNT"

# Count active rides
RIDE_COUNT=$(docker exec swiftride-ai-redis-1  redis-cli KEYS "ride:*" 2>/dev/null | wc -l || echo "0")
echo "Active Rides: $RIDE_COUNT"

# Database connection test
DB_CONN=$(docker exec swiftride-ai-postgres-1  psql -U uber -d uber_clone -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | xargs || echo "0")
echo "Total Users in DB: $DB_CONN"

echo ""
echo "System is ready for portfolio demo!"