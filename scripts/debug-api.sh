#!/bin/bash

echo "=== Debugging API ==="

# 1. Check if API is running
echo "1. Checking API health..."
curl -s http://localhost:3001/health || echo "❌ API not running!"

# 2. Check Docker containers
echo -e "\n2. Checking Docker containers..."
docker ps --format "table {{.Names}}\t{{.Status}}"

# 3. Check database connection
echo -e "\n3. Checking database..."
docker exec swiftride-ai-postgres-1 psql -U uber -d uber_clone -c "SELECT 1" 2>/dev/null || echo "❌ Database not accessible"

# 4. Check Redis
echo -e "\n4. Checking Redis..."
docker exec swiftride-ai-redis-1 redis-cli ping 2>/dev/null || echo "❌ Redis not accessible"

# 5. Test auth endpoint
echo -e "\n5. Testing auth endpoint..."
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}' \
  | head -c 200

# 6. Check if users exist in database
echo -e "\n\n6. Checking users in database..."
docker exec swiftride-ai-postgres-1 psql -U uber -d uber_clone -c "SELECT email, role FROM users LIMIT 5" 2>/dev/null || echo "No users found"

echo -e "\n=== Debug Complete ==="