#!/bin/bash
# Railway production entrypoint script
set -e

echo "=== HMS Backend Startup ==="
echo "PORT: ${PORT:-8000}"
echo "Working directory: $(pwd)"

# Run the Python startup script
# This handles DB waiting, migrations (with locking), and verification
python startup.py

echo "=== Starting Gunicorn on port ${PORT:-8000} ==="
exec gunicorn hms_backend.wsgi:application \
    --bind 0.0.0.0:${PORT:-8000} \
    --workers 8 \
    --threads 8 \
    --timeout 30 \
    --access-logfile - \
    --error-logfile -