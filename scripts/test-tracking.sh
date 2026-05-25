#!/bin/bash

BASE_URL="http://localhost:3001/api"

echo "=== Testing Driver Location Tracking ===\n"

# First, login as driver
echo "1. Logging in as driver..."
LOGIN_RESPONSE=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "driver@test.com",
    "password": "password123"
  }')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.accessToken')
echo "Access token obtained"

# Update driver location
echo "\n2. Updating driver location..."
curl -s -X POST $BASE_URL/driver/location/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "latitude": 40.7128,
    "longitude": -74.0060,
    "status": "online"
  }' | jq '.'

# Get driver status
echo "\n3. Getting driver status..."
curl -s -X GET $BASE_URL/driver/status \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.'

# Set driver online
echo "\n4. Setting driver online..."
curl -s -X POST $BASE_URL/driver/status/set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "newStatus": "online",
    "latitude": 40.7128,
    "longitude": -74.0060
  }' | jq '.'

# Test nearby drivers endpoint (requires rider token)
echo "\n5. Testing nearby drivers (as rider)..."
RIDER_LOGIN=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rider@test.com",
    "password": "password123"
  }')

RIDER_TOKEN=$(echo $RIDER_LOGIN | jq -r '.accessToken')

curl -s -X GET "$BASE_URL/driver/nearby?lat=40.7128&lng=-74.0060&radius=5" \
  -H "Authorization: Bearer $RIDER_TOKEN" | jq '.'

echo "\n✅ Location tracking test complete!"

# Check Redis GEO data
echo "\n6. Checking Redis GEO data..."
docker exec swiftride-ai-redis-1 redis-cli GEORADIUS drivers:online -74.0060 40.7128 5 km WITHCOORD