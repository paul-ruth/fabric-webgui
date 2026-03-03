FROM python:3.11-slim

WORKDIR /app

# Install system deps for FABlib (SSH, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc python3-dev libffi-dev libssl-dev openssh-client git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/

# Copy builtin slice-libraries (slice templates, VM templates, recipes) — synced before build
COPY slice-libraries/ slice-libraries/

RUN mkdir -p /fabric_config && chmod 700 /fabric_config
RUN mkdir -p /fabric_storage && chmod 755 /fabric_storage

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
