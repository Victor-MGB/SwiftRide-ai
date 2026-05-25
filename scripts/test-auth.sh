#!/bin/bash

BASE_URL="http://localhost:3001/api"

echo "=== Testing Authentication System ===\n"

# 1. Rider Signup
echo "1. Creating rider account..."
RIDER_RESPONSE=$(curl -s -X POST $BASE_URL/auth/signup/rider \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rider@test.com",
    "phone": "+1234567890",
    "fullName": "Test Rider",
    "password": "password123"
  }')
echo $RIDER_RESPONSE | jq '.'
ACCESS_TOKEN=$(echo $RIDER_RESPONSE | jq -r '.accessToken')

# 2. Driver Signup
echo "\n2. Creating driver account..."
DRIVER_RESPONSE=$(curl -s -X POST $BASE_URL/auth/signup/driver \
  -H "Content-Type: application/json" \
  -d '{
    "email": "driver@test.com",
    "phone": "+1987654321",
    "fullName": "Test Driver",
    "password": "password123",
    "vehicleModel": "Tesla Model 3",
    "vehiclePlate": "ABC-1234",
    "vehicleColor": "Red",
    "licensePlate": "XYZ-5678"
  }')
echo $DRIVER_RESPONSE | jq '.'

# 3. Login
echo "\n3. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rider@test.com",
    "password": "password123"
  }')
echo $LOGIN_RESPONSE | jq '.'

# 4. Access protected route
echo "\n4. Accessing protected route..."
curl -s -X GET $BASE_URL/driver/dashboard \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.'

echo "\n✅ Auth system test complete!"