#!/bin/bash
set -ex

# ── Install Prometheus (binary) ──────────────────────────────────────
PROM_VER="2.53.3"
cd /tmp
curl -fsSLO "https://github.com/prometheus/prometheus/releases/download/v${PROM_VER}/prometheus-${PROM_VER}.linux-amd64.tar.gz"
tar xzf "prometheus-${PROM_VER}.linux-amd64.tar.gz"
sudo cp "prometheus-${PROM_VER}.linux-amd64/prometheus" /usr/local/bin/
sudo cp "prometheus-${PROM_VER}.linux-amd64/promtool"   /usr/local/bin/
sudo mkdir -p /etc/prometheus /var/lib/prometheus

# Detect the FABNetv4 subnet from the local interface
FABNET_IP=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+(?=/\d+)' | head -1)
FABNET_SUBNET=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+/\d+' | head -1)

# Minimal Prometheus config — file_sd auto-discovery
sudo tee /etc/prometheus/prometheus.yml > /dev/null <<PROMEOF
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']

  - job_name: node
    file_sd_configs:
      - files: ['/etc/prometheus/targets/*.json']
        refresh_interval: 30s
PROMEOF

sudo mkdir -p /etc/prometheus/targets

# Systemd unit for Prometheus
sudo tee /etc/systemd/system/prometheus.service > /dev/null <<'SVCEOF'
[Unit]
Description=Prometheus
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus \
  --web.listen-address=0.0.0.0:9090
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable --now prometheus

# ── Install Grafana (apt) ────────────────────────────────────────────
sudo apt-get update -qq
sudo apt-get install -y -qq apt-transport-https software-properties-common
curl -fsSL https://apt.grafana.com/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/grafana.gpg
echo "deb [signed-by=/usr/share/keyrings/grafana.gpg] https://apt.grafana.com stable main" | \
  sudo tee /etc/apt/sources.list.d/grafana.list
sudo apt-get update -qq
sudo apt-get install -y -qq grafana

# Auto-provision Prometheus datasource
sudo mkdir -p /etc/grafana/provisioning/datasources
sudo tee /etc/grafana/provisioning/datasources/prometheus.yml > /dev/null <<'DSEOF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://localhost:9090
    isDefault: true
DSEOF

sudo systemctl enable --now grafana-server

# ── Auto-discovery timer ─────────────────────────────────────────────
# Scans the FABNetv4 subnet for hosts with port 9100 open and writes
# a file_sd JSON target list for Prometheus.
sudo tee /usr/local/bin/discover-exporters.sh > /dev/null <<'DISCEOF'
#!/bin/bash
SUBNET=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+/\d+' | head -1)
[ -z "$SUBNET" ] && exit 0

mkdir -p /etc/prometheus/targets
TARGETS="["
FIRST=true

for ip in $(nmap -sn "$SUBNET" -oG - 2>/dev/null | awk '/Up$/{print $2}'); do
  if nc -z -w1 "$ip" 9100 2>/dev/null; then
    $FIRST || TARGETS="$TARGETS,"
    TARGETS="$TARGETS{\"targets\":[\"$ip:9100\"],\"labels\":{\"job\":\"node\"}}"
    FIRST=false
  fi
done

TARGETS="$TARGETS]"
echo "$TARGETS" > /etc/prometheus/targets/fabnet-nodes.json
DISCEOF

sudo chmod +x /usr/local/bin/discover-exporters.sh
sudo apt-get install -y -qq nmap ncat

# Systemd timer to run discovery every 60 seconds
sudo tee /etc/systemd/system/discover-exporters.service > /dev/null <<'SVCEOF'
[Unit]
Description=Discover node_exporter targets on FABNetv4

[Service]
Type=oneshot
ExecStart=/usr/local/bin/discover-exporters.sh
SVCEOF

sudo tee /etc/systemd/system/discover-exporters.timer > /dev/null <<'TMREOF'
[Unit]
Description=Run exporter discovery every 60s

[Timer]
OnBootSec=30
OnUnitActiveSec=60

[Install]
WantedBy=timers.target
TMREOF

sudo systemctl daemon-reload
sudo systemctl enable --now discover-exporters.timer

# Run discovery once now
sudo /usr/local/bin/discover-exporters.sh

echo "=== Monitor setup complete ==="
echo "Prometheus: http://<this-node>:9090"
echo "Grafana:    http://<this-node>:3000  (admin/admin)"
