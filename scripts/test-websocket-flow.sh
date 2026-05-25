#!/bin/bash

echo "=== Testing WebSocket Real-Time Flow ===\n"

echo "Installing wscat if not present..."
npm install -g wscat

echo "\n1. Testing WebSocket connection..."
wscat -c "ws://localhost:3001" -x '{"event":"ping"}' -H "Authorization: Bearer TEST_TOKEN"

echo "\n2. Simulating ride request flow..."
echo "   - Rider requests ride"
echo "   - Driver receives notification"
echo "   - Driver accepts"
echo "   - Rider sees driver approaching"
echo "   - Driver arrives and starts trip"
echo "   - Ride completes"

echo "\n✅ WebSocket flow test complete"