#!/bin/bash

BASE_URL="http://localhost:3001/api"

echo "=== Testing ETA & Routing System ===\n"

# 1. Test route calculation
echo "1. Testing route calculation..."
curl -s -X POST $BASE_URL/routing/route \
  -H "Content-Type: application/json" \
  -d '{
    "origin": {"lat": 40.7128, "lng": -74.0060},
    "destination": {"lat": 40.7580, "lng": -73.9855}
  }' | jq '.'

# 2. Get login token
echo "\n2. Getting auth token..."
LOGIN_RESPONSE=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rider@test.com",
    "password": "password123"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.accessToken')

# 3. Create a ride request
echo "\n3. Creating ride request..."
RIDE_RESPONSE=$(curl -s -X POST $BASE_URL/rides/request \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pickupLat": 40.7128,
    "pickupLng": -74.0060,
    "dropoffLat": 40.7580,
    "dropoffLng": -73.9855
  }')

RIDE_ID=$(echo $RIDE_RESPONSE | jq -r '.rideId')
echo "Ride ID: $RIDE_ID"

# 4. Get ETA for the ride
echo "\n4. Getting ETA for ride..."
curl -s -X GET "$BASE_URL/routing/eta/$RIDE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# 5. Test batch ETA (simulate multiple drivers)
echo "\n5. Testing batch ETA for multiple drivers..."
curl -s -X POST $BASE_URL/routing/batch-eta \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pickup": {"lat": 40.7128, "lng": -74.0060},
    "drivers": [
      {"driverId": "driver1", "location": {"lat": 40.7150, "lng": -74.0100}},
      {"driverId": "driver2", "location": {"lat": 40.7200, "lng": -74.0000}},
      {"driverId": "driver3", "location": {"lat": 40.7000, "lng": -74.0200}}
    ]
  }' | jq '.'

echo "\n✅ ETA system test complete!"