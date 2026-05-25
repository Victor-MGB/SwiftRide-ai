#!/bin/bash

echo "=== SwiftRide Uber Clone API Test ===\n"

# Step 1: Health check
echo "1. Testing health..."
curl -s http://localhost:3001/health | jq '.'

# Step 2: Add driver online
echo "\n2. Adding driver online..."
curl -s -X POST http://localhost:3001/api/driver/location \
  -H "Content-Type: application/json" \
  -d '{
    "driverId": "driver_1",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "status": "online"
  }' | jq '.'

sleep 1

# Step 3: Request ride
echo "\n3. Requesting ride..."
RIDE_RESPONSE=$(curl -s -X POST http://localhost:3001/api/rides/request \
  -H "Content-Type: application/json" \
  -d '{
    "riderId": "rider_1",
    "pickupLat": 40.7128,
    "pickupLng": -74.0060,
    "dropoffLat": 40.7580,
    "dropoffLng": -73.9855
  }')

echo $RIDE_RESPONSE | jq '.'

# Extract rideId if present
RIDE_ID=$(echo $RIDE_RESPONSE | jq -r '.rideId')
if [ "$RIDE_ID" != "null" ] && [ "$RIDE_ID" != "" ]; then
    echo "\n4. Driver accepting ride $RIDE_ID..."
    curl -s -X POST http://localhost:3001/api/rides/$RIDE_ID/accept \
      -H "Content-Type: application/json" \
      -d '{"driverId": "driver_1"}' | jq '.'
    
    echo "\n5. Checking ride status..."
    curl -s http://localhost:3001/api/rides/$RIDE_ID/status | jq '.'
fi

echo "\n=== Test Complete ==="