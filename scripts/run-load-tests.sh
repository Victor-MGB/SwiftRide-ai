#!/bin/bash

echo "=== Running Load Tests ==="

# Install k6 if not present
if ! command -v k6 &> /dev/null; then
    echo "Installing k6..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install k6
    else
        sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
        echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
        sudo apt-get update
        sudo apt-get install k6
    fi
fi

# Set environment variables
export BASE_URL="http://localhost:3001"
export WS_URL="ws://localhost:3002"

# Run smoke test (quick validation)
echo "1. Running smoke test..."
k6 run tests/load/ride-request.test.js --duration 30s --vus 10

# Run load test
echo "2. Running load test (1000 concurrent users)..."
k6 run tests/load/ride-request.test.js

# Run stress test
echo "3. Running stress test (spike to 2000 users)..."
k6 run tests/load/stress-test.js

# Run WebSocket test
echo "4. Running WebSocket load test..."
k6 run tests/load/websocket.test.js

# Generate HTML report
echo "5. Generating HTML report..."
k6 run tests/load/ride-request.test.js --out json=results.json
k6-reporter results.json report.html

echo "✅ Load tests completed! Report saved to report.html"