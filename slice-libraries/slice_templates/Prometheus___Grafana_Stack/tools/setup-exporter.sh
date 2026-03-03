#!/bin/bash
set -ex
# Run Prometheus node_exporter
sudo docker run -d --name node-exporter --restart always \
  --net host --pid host \
  -v /:/host:ro,rslave \
  prom/node-exporter --path.rootfs=/host
