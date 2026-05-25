#!/bin/bash

echo "=== Creating Test User for Load Testing ==="

# Create test rider
echo "Creating test rider..."
curl -X POST http://localhost:3001/api/auth/signup/rider \
  -H "Content-Type: application/json" \
  -d '{
    "email": "loadtest@example.com",
    "phone": "+19999999999",
    "fullName": "Load Test User",
    "password": "Test123!@#",
    "role": "rider"
  }'

echo -e "\n\n✅ Test user created!"

# Test login
echo -e "\nTesting login..."
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "loadtest@example.com",
    "password": "Test123!@#"
  }' | jq '.'

echo -e "\n✅ Setup complete! You can now run: k6 run tests/load/simple-test.js"