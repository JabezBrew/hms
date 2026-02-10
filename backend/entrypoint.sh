#!/bin/bash
# Railway production entrypoint script
# DO NOT use 'set -e' - we need to see errors

# Force immediate output flushing
export PYTHONUNBUFFERED=1

# Print startup info immediately
echo "=== HMS Backend Entrypoint Started ===" >&2
echo "[entrypoint] PORT=${PORT:-not set}" >&2
echo "[entrypoint] PWD=$(pwd)" >&2
echo "[entrypoint] User=$(whoami)" >&2
echo "[entrypoint] Python=$(which python)" >&2

# Check if required files exist
echo "[entrypoint] Checking files..." >&2
ls -la /app/startup.py /app/manage.py 2>&1 | head -5 >&2

# Check critical environment variables
echo "[entrypoint] Checking env vars..." >&2
if [ -z "$SECRET_KEY" ]; then
    echo "[entrypoint] ERROR: SECRET_KEY is not set!" >&2
fi
if [ -z "$DATABASE_URL" ]; then
    echo "[entrypoint] WARNING: DATABASE_URL is not set" >&2
fi

# Run Python startup with explicit error output
echo "[entrypoint] Running startup.py..." >&2
python /app/startup.py 2>&1
STARTUP_EXIT_CODE=$?

if [ $STARTUP_EXIT_CODE -ne 0 ]; then
    echo "[entrypoint] ERROR: startup.py failed with exit code $STARTUP_EXIT_CODE" >&2
    echo "[entrypoint] Attempting to show Django check errors..." >&2
    python -c "import django; django.setup()" 2>&1 || true
    exit 1
fi

echo "[entrypoint] startup.py completed successfully" >&2

# Start Daphne (ASGI server for HTTP + WebSocket support)
echo "[entrypoint] Starting Daphne on port ${PORT:-8000}..." >&2
exec daphne hms_backend.asgi:application \
    --bind "0.0.0.0" \
    --port "${PORT:-8000}" \
    --proxy-headers \
    --access-log - \
    --websocket_timeout -1
