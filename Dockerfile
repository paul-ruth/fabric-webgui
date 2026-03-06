# Combined single-image Dockerfile for fabric-webui
# Serves both the FastAPI backend and nginx frontend in one container

# --- Stage 1: Build frontend ---
FROM node:18-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# --- Stage 2: Final image ---
FROM python:3.11-slim

WORKDIR /app

# Install system deps for FABlib + nginx + supervisord
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc python3-dev libffi-dev libssl-dev openssh-client git \
    nginx supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/app/ app/

# Copy version file for update checks (read by backend)
COPY frontend/src/version.ts /app/VERSION

# Copy builtin slice-libraries (slice templates, VM templates, recipes)
COPY slice-libraries/ slice-libraries/

# Copy AI tools config (skills, agents, shared context)
COPY ai-tools/ ai-tools/

# Copy built frontend
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# Nginx config — use localhost since backend runs in same container
RUN rm -f /etc/nginx/sites-enabled/default
RUN cat > /etc/nginx/conf.d/default.conf <<'NGINX'
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    client_max_body_size 500m;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
    }
}
NGINX

# Supervisord config to run both nginx and uvicorn
RUN cat > /etc/supervisor/conf.d/fabric-webui.conf <<'CONF'
[supervisord]
nodaemon=true
user=root
logfile=/dev/stdout
logfile_maxbytes=0

[program:backend]
command=uvicorn app.main:app --host 0.0.0.0 --port 8000
directory=/app
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:nginx]
command=nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
CONF

# Create storage directory (config lives inside storage at .fabric_config)
RUN mkdir -p /fabric_storage && chmod 755 /fabric_storage
ENV FABRIC_CONFIG_DIR=/fabric_storage/.fabric_config
ENV FABRIC_STORAGE_DIR=/fabric_storage
ENV HOME=/tmp

# Frontend on 3000, backend on 8000, 9100-9199 for SSH tunnel proxies
EXPOSE 3000 8000 9100-9199

CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
