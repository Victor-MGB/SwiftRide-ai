#!/bin/bash

BASE_URL="http://localhost:3001/api"

echo "=== Testing Payment System ==="

# Login
echo -e "\n1. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rider@test.com",
    "password": "password123"
  }')

echo "Login raw response:"
echo "$LOGIN_RESPONSE" | head -c 500

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken // empty')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo " Failed to get token. Login probably failed."
    exit 1
fi

echo "Token received: ${TOKEN:0:20}..."

# Check wallet balance
echo -e "\n2. Checking wallet balance..."
WALLET_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET $BASE_URL/payment/wallet \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$WALLET_RESPONSE" | tail -n1)
BODY=$(echo "$WALLET_RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | head -c 400
echo "$BODY" | jq '.' 2>/dev/null || echo "❌ Not valid JSON"

# Apply promo code
echo -e "\n3. Applying promo code..."
PROMO_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST $BASE_URL/payment/promo/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "promoCode": "TEST2024",
    "orderAmount": 25.00
  }')

HTTP_CODE=$(echo "$PROMO_RESPONSE" | tail -n1)
BODY=$(echo "$PROMO_RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | head -c 400
echo "$BODY" | jq '.' 2>/dev/null || echo "❌ Not valid JSON"

# Get ride receipt
echo -e "\n4. Getting ride receipt..."
RIDE_ID="ride_example_123"
RECEIPT_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/payment/receipt/$RIDE_ID" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$RECEIPT_RESPONSE" | tail -n1)
BODY=$(echo "$RECEIPT_RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | head -c 400
echo "$BODY" | jq '.' 2>/dev/null || echo "❌ Not valid JSON"

echo -e "\n✅ Payment system test complete!"