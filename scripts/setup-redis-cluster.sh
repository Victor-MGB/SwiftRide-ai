#!/bin/bash

echo "Setting up Redis Cluster for GEO Data..."

# Create 6 Redis nodes (3 masters, 3 slaves)
for i in {1..6}
do
  docker run -d \
    --name redis-node-$i \
    --net ride-hailing-net \
    -v redis-data-$i:/data \
    redis:7-alpine \
    redis-server --cluster-enabled yes \
                 --cluster-config-file nodes.conf \
                 --appendonly yes \
                 --port 6379
done

# Wait for nodes to start
sleep 5

# Create cluster
docker exec -it redis-node-1 redis-cli --cluster create \
  redis-node-1:6379 \
  redis-node-2:6379 \
  redis-node-3:6379 \
  redis-node-4:6379 \
  redis-node-5:6379 \
  redis-node-6:6379 \
  --cluster-replicas 1

# Verify cluster
docker exec -it redis-node-1 redis-cli cluster info

echo "Redis Cluster ready!"