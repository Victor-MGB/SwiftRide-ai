#!/bin/bash

echo "=== Setting up Monitoring Stack ==="

# Start monitoring services
docker-compose -f docker-compose.prod.yml up -d prometheus grafana alertmanager

# Wait for services to be ready
sleep 10

# Configure Grafana data source
curl -X POST http://admin:admin@localhost:3000/api/datasources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Prometheus",
    "type": "prometheus",
    "url": "http://prometheus:9090",
    "access": "proxy",
    "isDefault": true
  }'

# Import dashboard
curl -X POST http://admin:admin@localhost:3000/api/dashboards/db \
  -H "Content-Type: application/json" \
  -d @configs/grafana/dashboards/ride-hailing-dashboard.json

# Configure alert channels
curl -X POST http://admin:admin@localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d @configs/alertmanager/slack-config.json

echo "✅ Monitoring stack configured!"
echo "Grafana: http://localhost:3000 (admin/admin)"
echo "Prometheus: http://localhost:9090"
echo "AlertManager: http://localhost:9093"