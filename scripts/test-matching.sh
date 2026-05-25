#!/bin/bash

BASE_URL="http://localhost:3001/api"

echo "=== Testing Complete Ride Matching Flow ===\n"

# 1. Login as rider
echo "1. Rider login..."
RIDER_LOGIN=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rider@test.com",
    "password": "password123"
  }')

RIDER_TOKEN=$(echo $RIDER_LOGIN | jq -r '.accessToken')
echo "Rider token obtained"

# 2. Login as driver
echo "\n2. Driver login..."
DRIVER_LOGIN=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "driver@test.com",
    "password": "password123"
  }')

DRIVER_TOKEN=$(echo $DRIVER_LOGIN | jq -r '.accessToken')
echo "Driver token obtained"

# 3. Set driver online with location
echo "\n3. Setting driver online..."
curl -s -X POST $BASE_URL/driver/status/set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -d '{
    "newStatus": "online",
    "latitude": 40.7128,
    "longitude": -74.0060
  }' | jq '.'

# 4. Check nearby drivers from rider perspective
echo "\n4. Checking nearby drivers..."
curl -s -X GET "$BASE_URL/rides/nearby-drivers?lat=40.7128&lng=-74.0060&radius=5" \
  -H "Authorization: Bearer $RIDER_TOKEN" | jq '.'

# 5. Request a ride
echo "\n5. Requesting a ride..."
RIDE_RESPONSE=$(curl -s -X POST $BASE_URL/rides/request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RIDER_TOKEN" \
  -d '{
    "pickupLat": 40.7128,
    "pickupLng": -74.0060,
    "dropoffLat": 40.7580,
    "dropoffLng": -73.9855
  }')

echo $RIDE_RESPONSE | jq '.'
RIDE_ID=$(echo $RIDE_RESPONSE | jq -r '.rideId')
echo "Ride ID: $RIDE_ID"

# 6. Check ride status
echo "\n6. Checking ride status..."
sleep 2
curl -s -X GET "$BASE_URL/rides/$RIDE_ID/status" \
  -H "Authorization: Bearer $RIDER_TOKEN" | jq '.'

# 7. Test Redis GEO data
echo "\n7. Checking Redis GEO index..."
docker exec swiftride-ai-redis-1 redis-cli ZRANGE drivers:online 0 -1 WITHSCORES

# 8. Test ride data in Redis
echo "\n8. Checking ride data in Redis..."
docker exec swiftride-ai-redis-1 redis-cli HGETALL "ride:$RIDE_ID"

echo "\n✅ Matching system test complete!"