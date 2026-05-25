#!/bin/bash

# Swiftride AI - Quick System Test Script

BASE_URL="http://localhost:3001"
echo "=== Swiftride AI Quick System Test ==="
echo "Base URL: $BASE_URL"
echo "Timestamp: $(date)"
echo "------------------------------"

# Helper function
check_error() {
  if echo "$1" | jq -e '.error' > /dev/null; then
    echo "Error: $(echo "$1" | jq -r '.error')"
    return 1
  fi
  return 0
}

# 1. Health Check
echo -e "\n[1] Health Check"
HEALTH=$(curl -s $BASE_URL/health)
echo "$HEALTH" | jq '.'

# 2. Rider - Signup or Login
echo -e "\n[2] Rider Account (test_rider@example.com)"
RIDER_RESPONSE=$(curl -s -X POST $BASE_URL/api/auth/signup/rider \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test_rider@example.com",
    "phone": "+1234567890",
    "fullName": "Test Rider",
    "password": "Test123!@#"
  }')

if echo "$RIDER_RESPONSE" | jq -e '.error' > /dev/null; then
  echo "→ User exists, logging in..."
  RIDER_RESPONSE=$(curl -s -X POST $BASE_URL/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test_rider@example.com",
      "password": "Test123!@#"
    }')
fi

echo "$RIDER_RESPONSE" | jq '.'
RIDER_TOKEN=$(echo "$RIDER_RESPONSE" | jq -r '.accessToken // empty')

# 3. Driver - Signup or Login
echo -e "\n[3] Driver Account (test_driver@example.com)"
DRIVER_RESPONSE=$(curl -s -X POST $BASE_URL/api/auth/signup/driver \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test_driver@example.com",
    "phone": "+1987654321",
    "fullName": "Test Driver",
    "password": "Test123!@#",
    "vehicleModel": "Tesla Model 3",
    "vehiclePlate": "ABC-1234",
    "vehicleColor": "Red",
    "licensePlate": "XYZ-5678"
  }')

if echo "$DRIVER_RESPONSE" | jq -e '.error' > /dev/null; then
  echo "→ Driver exists, logging in..."
  DRIVER_RESPONSE=$(curl -s -X POST $BASE_URL/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test_driver@example.com",
      "password": "Test123!@#"
    }')
fi

echo "$DRIVER_RESPONSE" | jq '.'
DRIVER_TOKEN=$(echo "$DRIVER_RESPONSE" | jq -r '.accessToken // empty')

# 4. Set Driver Online
if [ -n "$DRIVER_TOKEN" ] && [ "$DRIVER_TOKEN" != "null" ] && [ "$DRIVER_TOKEN" != "empty" ]; then
  echo -e "\n[4] Setting Driver Online"
  curl -s -X POST $BASE_URL/api/driver/status/set \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "newStatus": "online",
      "latitude": 40.7128,
      "longitude": -74.0060
    }' | jq '.'
else
  echo -e "\n[4]  Skipping: No driver token"
fi

# 5. Update Driver Location
if [ -n "$DRIVER_TOKEN" ] && [ "$DRIVER_TOKEN" != "null" ] && [ "$DRIVER_TOKEN" != "empty" ]; then
  echo -e "\n[5] Updating Driver Location"
  curl -s -X POST $BASE_URL/api/driver/location/update \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "latitude": 40.7306,
      "longitude": -73.9352,
      "status": "online"
    }' | jq '.'
fi

# 6. Request Ride (Rider)
if [ -n "$RIDER_TOKEN" ] && [ "$RIDER_TOKEN" != "null" ] && [ "$RIDER_TOKEN" != "empty" ]; then
  echo -e "\n[6] Requesting Ride"
  RIDE_RESPONSE=$(curl -s -X POST $BASE_URL/api/rides/request \
    -H "Authorization: Bearer $RIDER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "pickupLat": 40.7128,
      "pickupLng": -74.0060,
      "dropoffLat": 40.7580,
      "dropoffLng": -73.9855
    }')
  echo "$RIDE_RESPONSE" | jq '.'
  RIDE_ID=$(echo "$RIDE_RESPONSE" | jq -r '.rideId // empty')
else
  echo -e "\n[6] Skipping ride request: No rider token"
fi

echo -e "\n Quick System Test Completed!\n"