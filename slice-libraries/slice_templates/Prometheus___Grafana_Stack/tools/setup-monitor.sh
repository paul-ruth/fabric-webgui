#!/bin/bash
set -ex
# Install Prometheus config
sudo mkdir -p /etc/prometheus
sudo cp ~/tools/prometheus.yml /etc/prometheus/prometheus.yml

# Run Prometheus
sudo docker run -d --name prometheus --restart always \
  --net host \
  -v /etc/prometheus:/etc/prometheus \
  prom/prometheus

# Run Grafana
sudo docker run -d --name grafana --restart always \
  -p 3000:3000 \
  grafana/grafana
