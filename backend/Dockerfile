FROM python:3.11-slim

WORKDIR /app

# Install system deps for FABlib (SSH, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc python3-dev libffi-dev libssl-dev openssh-client git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node.js for AI CLI tools
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install AI CLI tools (best-effort — failures won't block build)
# aider-chat is large; install with minimal deps
RUN pip install --no-cache-dir aider-chat || true
RUN npm install -g @anthropic-ai/claude-code 2>/dev/null || true
RUN npm install -g opencode-ai 2>/dev/null || true

COPY scripts/ scripts/
COPY app/ app/
COPY VERSION /app/VERSION
COPY WEAVE.md /app/WEAVE.md

# Copy builtin slice-libraries (slice templates, VM templates, recipes) — synced before build
COPY slice-libraries/ slice-libraries/

RUN mkdir -p /fabric_config && chmod 700 /fabric_config
RUN mkdir -p /fabric_storage && chmod 755 /fabric_storage

# Seed OpenCode config (FABRIC AI server + default model)
COPY opencode.json /fabric_storage/opencode.json

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
