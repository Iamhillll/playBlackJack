#!/usr/bin/env bash
# Helper to run an nginx container serving this workspace on port 8000
# Usage: ./run-server-docker.sh [container-name]

NAME=${1:-playblackjack-static}
HOST_PORT=${HOST_PORT:-8000}

echo "Starting nginx container '$NAME' serving $(pwd) on host port $HOST_PORT"

docker rm -f "$NAME" 2>/dev/null || true

docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  -p ${HOST_PORT}:80 \
  -v "$(pwd)":/usr/share/nginx/html:ro \
  -v "$(pwd)/nginx.conf":/etc/nginx/conf.d/default.conf:ro \
  nginx:stable-alpine

if [ $? -eq 0 ]; then
  echo "Container started. To stop: docker rm -f $NAME"
  docker ps --filter "name=$NAME" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
else
  echo "Failed to start container. See 'docker ps -a' and logs with 'docker logs $NAME'"
fi
