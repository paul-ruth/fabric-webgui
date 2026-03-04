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

# Enable embedding (for Client View iframe) and anonymous access
sudo tee -a /etc/grafana/grafana.ini > /dev/null <<'INIEOF'

[security]
allow_embedding = true

[auth.anonymous]
enabled = true
org_role = Viewer
INIEOF

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

# ── Provision Grafana dashboard (background) ─────────────────────
# Wait for Grafana API, import Node Exporter Full dashboard (ID 1860),
# and set it as the home dashboard. Runs in background so script can finish.
(
  # Wait for Grafana to be ready (up to 60s)
  for i in $(seq 1 30); do
    curl -sf http://localhost:3000/api/health > /dev/null 2>&1 && break
    sleep 2
  done

  # Download dashboard JSON from grafana.com
  DASH_JSON=$(curl -sf https://grafana.com/api/dashboards/1860/revisions/37/download)
  if [ -n "$DASH_JSON" ]; then
    # Import via Grafana API
    IMPORT_PAYLOAD=$(cat <<IPEOF
{
  "dashboard": $DASH_JSON,
  "overwrite": true,
  "inputs": [
    {
      "name": "DS_PROMETHEUS",
      "type": "datasource",
      "pluginId": "prometheus",
      "value": "Prometheus"
    }
  ],
  "folderId": 0
}
IPEOF
)
    RESULT=$(curl -sf -X POST http://localhost:3000/api/dashboards/import \
      -H 'Content-Type: application/json' \
      -u admin:admin \
      -d "$IMPORT_PAYLOAD")

    # Extract dashboard UID and set as home dashboard for the default org
    DASH_UID=$(echo "$RESULT" | grep -oP '"uid"\s*:\s*"\K[^"]+' | head -1)
    if [ -n "$DASH_UID" ]; then
      # Set as org home dashboard
      curl -sf -X PUT http://localhost:3000/api/org/preferences \
        -H 'Content-Type: application/json' \
        -u admin:admin \
        -d "{\"homeDashboardUID\":\"$DASH_UID\"}"
      echo "Grafana: dashboard 1860 imported and set as home (UID=$DASH_UID)"
    fi
  else
    echo "Warning: could not download dashboard 1860 from grafana.com"
  fi
) &

# ── Background discovery retry ───────────────────────────────────
# Workers may not have node_exporter running yet. Retry until at least
# one target is found (up to 5 minutes).
(
  for i in $(seq 1 30); do
    sudo /usr/local/bin/discover-exporters.sh
    if grep -q '9100' /etc/prometheus/targets/fabnet-nodes.json 2>/dev/null; then
      echo "Discovery: found exporters on attempt $i"
      break
    fi
    sleep 10
  done
) &

echo "=== Monitor setup complete ==="
echo "Prometheus: http://<this-node>:9090"
echo "Grafana:    http://<this-node>:3000  (no login required)"
