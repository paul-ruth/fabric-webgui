#!/bin/bash
set -ex

# ── Wait for FABNetv4 interface to be configured ──────────────────────
# FABlib post_boot_config assigns a 10.128.0.0/10 address to the NIC.
# Poll until the IP appears (up to 5 minutes).
echo "### PROGRESS: Waiting for FABNetv4 interface"
FABNET_IP=""
FABNET_SUBNET=""
for i in $(seq 1 60); do
  FABNET_IP=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+(?=/\d+)' | head -1)
  FABNET_SUBNET=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+/\d+' | head -1)
  if [ -n "$FABNET_IP" ]; then
    echo "FABNetv4 IP: $FABNET_IP  Subnet: $FABNET_SUBNET"
    break
  fi
  sleep 5
done

if [ -z "$FABNET_IP" ]; then
  echo "WARNING: FABNetv4 interface not found after 5 minutes, continuing anyway"
fi

echo "### PROGRESS: Installing node_exporter on monitor"
# ── Install node_exporter on the monitor too ─────────────────────────
# So Prometheus also scrapes the monitor node itself.
NE_VER="1.8.2"
cd /tmp
curl -fsSLO "https://github.com/prometheus/node_exporter/releases/download/v${NE_VER}/node_exporter-${NE_VER}.linux-amd64.tar.gz"
tar xzf "node_exporter-${NE_VER}.linux-amd64.tar.gz"
sudo cp "node_exporter-${NE_VER}.linux-amd64/node_exporter" /usr/local/bin/
sudo chmod +x /usr/local/bin/node_exporter

sudo tee /etc/systemd/system/node_exporter.service > /dev/null <<'EOF'
[Unit]
Description=Prometheus Node Exporter
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/node_exporter \
  --web.listen-address=0.0.0.0:9100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now node_exporter

echo "### PROGRESS: Installing Prometheus"
# ── Install Prometheus (binary) ──────────────────────────────────────
PROM_VER="2.53.3"
cd /tmp
curl -fsSLO "https://github.com/prometheus/prometheus/releases/download/v${PROM_VER}/prometheus-${PROM_VER}.linux-amd64.tar.gz"
tar xzf "prometheus-${PROM_VER}.linux-amd64.tar.gz"
sudo cp "prometheus-${PROM_VER}.linux-amd64/prometheus" /usr/local/bin/
sudo cp "prometheus-${PROM_VER}.linux-amd64/promtool"   /usr/local/bin/
sudo mkdir -p /etc/prometheus /var/lib/prometheus /etc/prometheus/targets

# Prometheus config — scrapes self (prometheus + node_exporter) and
# auto-discovers workers via file_sd populated by discover-exporters.sh
sudo tee /etc/prometheus/prometheus.yml > /dev/null <<'PROMEOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']

  - job_name: node
    file_sd_configs:
      - files: ['/etc/prometheus/targets/*.json']
        refresh_interval: 30s
PROMEOF

# Systemd unit for Prometheus
sudo tee /etc/systemd/system/prometheus.service > /dev/null <<'SVCEOF'
[Unit]
Description=Prometheus
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus \
  --web.listen-address=0.0.0.0:9090 \
  --storage.tsdb.retention.time=30d
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

# Fix permissions so nobody user can write to storage
sudo chown -R nobody: /var/lib/prometheus /etc/prometheus

sudo systemctl daemon-reload
sudo systemctl enable --now prometheus

echo "### PROGRESS: Installing Grafana"
# ── Install Grafana (apt) ────────────────────────────────────────────
sudo apt-get update -qq
sudo apt-get install -y -qq apt-transport-https software-properties-common wget
wget -q -O /tmp/grafana.gpg.key https://apt.grafana.com/gpg.key
cat /tmp/grafana.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/grafana.gpg
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
    uid: prometheus
    access: proxy
    url: http://localhost:9090
    isDefault: true
    editable: false
DSEOF

# Grafana config: enable anonymous viewer access and embedding
sudo sed -i '/^\[security\]/,/^\[/{/^allow_embedding/d}' /etc/grafana/grafana.ini
sudo sed -i '/^\[auth.anonymous\]/,/^\[/{/^enabled\|^org_role/d}' /etc/grafana/grafana.ini

sudo tee -a /etc/grafana/grafana.ini > /dev/null <<'INIEOF'

[security]
allow_embedding = true

[auth.anonymous]
enabled = true
org_role = Viewer
INIEOF

sudo systemctl enable --now grafana-server

echo "### PROGRESS: Setting up auto-discovery for node_exporter targets"
# ── Auto-discovery script ─────────────────────────────────────────────
# Scans the FABNetv4 subnet for hosts with port 9100 open and writes
# a file_sd JSON target list for Prometheus.
sudo tee /usr/local/bin/discover-exporters.sh > /dev/null <<'DISCEOF'
#!/bin/bash
SUBNET=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+/\d+' | head -1)
[ -z "$SUBNET" ] && exit 0

mkdir -p /etc/prometheus/targets
TARGETS_FILE=/etc/prometheus/targets/fabnet-nodes.json

TARGETS="["
FIRST=true
for ip in $(nmap -sn "$SUBNET" -oG - 2>/dev/null | awk '/Up$/{print $2}'); do
  if nc -z -w2 "$ip" 9100 2>/dev/null; then
    $FIRST || TARGETS="$TARGETS,"
    HOSTNAME=$(nmap -sn "$ip" 2>/dev/null | grep -oP 'Nmap scan report for \K\S+' | head -1 || echo "$ip")
    TARGETS="$TARGETS{\"targets\":[\"$ip:9100\"],\"labels\":{\"job\":\"node\",\"instance\":\"$HOSTNAME\"}}"
    FIRST=false
  fi
done
TARGETS="$TARGETS]"

echo "$TARGETS" > "${TARGETS_FILE}.tmp"
mv "${TARGETS_FILE}.tmp" "$TARGETS_FILE"
echo "$(date): discovery found: $TARGETS"
DISCEOF

sudo chmod +x /usr/local/bin/discover-exporters.sh

# Install nmap and ncat for discovery
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

# ── Initial discovery + seeding self as target ───────────────────────
# Seed the monitor's own node_exporter first so Prometheus has something
# to scrape immediately, before workers are ready.
if [ -n "$FABNET_IP" ]; then
  sudo tee /etc/prometheus/targets/monitor-self.json > /dev/null <<SELFEOF
[{"targets":["${FABNET_IP}:9100"],"labels":{"job":"node","instance":"monitor"}}]
SELFEOF
  sudo chown nobody: /etc/prometheus/targets/monitor-self.json
fi

# Run discovery now (workers may not be ready yet, retried in background)
sudo /usr/local/bin/discover-exporters.sh || true

# ── Background: import Node Exporter Full dashboard into Grafana ──────
(
  echo "Waiting for Grafana API..."
  for i in $(seq 1 60); do
    curl -sf http://localhost:3000/api/health > /dev/null 2>&1 && break
    sleep 5
  done

  # Download "Node Exporter Full" dashboard (ID 1860) from grafana.com
  DASH_JSON=$(curl -sf "https://grafana.com/api/dashboards/1860/revisions/37/download" 2>/dev/null)
  if [ -z "$DASH_JSON" ]; then
    echo "WARNING: could not download dashboard 1860, trying latest revision"
    DASH_JSON=$(curl -sf "https://grafana.com/api/dashboards/1860/revisions/latest/download" 2>/dev/null)
  fi

  if [ -n "$DASH_JSON" ]; then
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
      -d "$IMPORT_PAYLOAD" 2>/dev/null)

    DASH_UID=$(echo "$RESULT" | grep -oP '"uid"\s*:\s*"\K[^"]+' | head -1)
    if [ -n "$DASH_UID" ]; then
      # Set as home dashboard for both admin user and anonymous org
      curl -sf -X PUT http://localhost:3000/api/org/preferences \
        -H 'Content-Type: application/json' \
        -u admin:admin \
        -d "{\"homeDashboardUID\":\"$DASH_UID\"}" > /dev/null
      echo "Grafana: dashboard 1860 imported and set as home (UID=$DASH_UID)"
    else
      echo "WARNING: dashboard import failed or UID not found. Result: $RESULT"
    fi
  else
    echo "WARNING: could not download Node Exporter Full dashboard"
  fi
) &

# ── Background: retry discovery until workers respond ────────────────
# Workers take a few minutes to install node_exporter after slice boot.
(
  for i in $(seq 1 30); do
    sleep 30
    sudo /usr/local/bin/discover-exporters.sh || true
    COUNT=$(grep -c '9100' /etc/prometheus/targets/fabnet-nodes.json 2>/dev/null || echo 0)
    echo "Discovery attempt $i: $COUNT targets found"
    # Stop retrying once we have targets beyond just the monitor itself
    if [ "$COUNT" -ge 2 ]; then
      echo "All expected targets found"
      break
    fi
  done
) &

echo ""
echo "=== Monitor setup complete ==="
echo "FABNet IP:   ${FABNET_IP:-not yet assigned}"
echo "Prometheus:  http://${FABNET_IP:-<this-node>}:9090"
echo "Grafana:     http://${FABNET_IP:-<this-node>}:3000  (anonymous viewer, no login)"
echo ""
echo "Grafana admin login: admin / admin"
echo "Dashboard 1860 (Node Exporter Full) is being imported in the background."
echo "Workers will appear in Grafana within ~5 minutes of their setup completing."
