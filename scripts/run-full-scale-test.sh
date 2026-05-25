#!/bin/bash

echo "========================================="
echo "   Full-Scale Load Test (1000 Riders + 500 Drivers)"
echo "========================================="

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo "Installing k6..."
    brew install k6
fi

# Set environment variables
export BASE_URL="http://localhost:3001"
export K6_WEB_DASHBOARD=true

# Create results directory
mkdir -p test-results

# Run the full-scale test
echo "Starting load test at $(date)"
echo "This will take approximately 20 minutes..."

k6 run tests/load/full-scale-test.js \
    --out json=test-results/full-scale-results.json \
    --summary-export=test-results/summary.json \
    --tag testid=full-scale-$(date +%Y%m%d-%H%M%S)

# Generate HTML report
echo "Generating HTML report..."
k6-reporter test-results/full-scale-results.json test-results/report.html

# Print summary
echo ""
echo "========================================="
echo "Test completed at $(date)"
echo "Results saved to test-results/"
echo "Open test-results/report.html to view"
echo "========================================="

# Extract key metrics
if [ -f test-results/summary.json ]; then
    echo ""
    echo "📊 Key Results:"
    cat test-results/summary.json | jq '.metrics | {
        ride_success_rate: .ride_success_rate,
        p95_latency: .http_req_duration."p(95)",
        error_rate: .http_req_failed,
        total_requests: .http_reqs
    }'
fi