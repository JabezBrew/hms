# Backend Dockerfile for container deployment
# Multi-stage build: builds dependencies, then runs Django with ASGI server
#
# This Dockerfile is designed to be built from the backend/ directory

# Build stage
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Production image
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=hms_backend.settings

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash appuser

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY . .

# Run collectstatic during build (bakes static files into image)
# We need a dummy secret key for this to work
RUN SECRET_KEY=build_dummy_key python manage.py collectstatic --noinput

# Copy entrypoint script and startup script
COPY entrypoint.sh /entrypoint.sh
COPY startup.py /app/startup.py
RUN chmod +x /entrypoint.sh

# Create logs directory and set permissions
RUN mkdir -p /app/logs && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose the ASGI port. Runtime can override with PORT.
EXPOSE 8000

# Health check - disabled temporarily for debugging
# HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
#     CMD curl -f http://localhost:${PORT:-8000}/api/health/ || exit 1

# Start the application using Python directly (bypass bash for debugging)
CMD ["python", "/app/startup_and_run.py"]
