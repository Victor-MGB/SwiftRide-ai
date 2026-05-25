#!/bin/bash

BASE_URL="http://localhost:3001/api"

echo "=== Testing Surge Pricing System ===\n"

# Login
echo "1. Getting auth token..."
LOGIN_RESPONSE=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rider@test.com",
    "password": "password123"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.accessToken')

# Test surge multiplier for location
echo "\n2. Getting surge multiplier for Downtown..."
curl -s -X GET "$BASE_URL/surge/multiplier?lat=40.7128&lng=-74.0060" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# Test surge multiplier for Airport
echo "\n3. Getting surge multiplier for Airport..."
curl -s -X GET "$BASE_URL/surge/multiplier?lat=40.6413&lng=-73.7781" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# Get all zones
echo "\n4. Getting all surge zones..."
curl -s -X GET "$BASE_URL/surge/zones" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# Get heatmap data
echo "\n5. Getting surge heatmap data..."
curl -s -X GET "$BASE_URL/surge/heatmap" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# Admin: Get analytics (requires admin login)
echo "\n6. Admin analytics (admin login required)..."
ADMIN_LOGIN=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.com",
    "password": "admin123"
  }')

ADMIN_TOKEN=$(echo $ADMIN_LOGIN | jq -r '.accessToken')

curl -s -X GET "$BASE_URL/surge/admin/analytics" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.summary'

echo "\n✅ Surge pricing test complete!"