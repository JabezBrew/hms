#!/bin/bash

# HMS Backend Startup Script
# This script starts Django, Celery worker, Celery beat, and Redis

set -e

echo "=== HMS Backend Startup ==="
echo ""

# Check if Redis is installed
if ! command -v redis-server &> /dev/null; then
    echo "❌ Redis is not installed!"
    echo "   Install it with: brew install redis (macOS) or apt-get install redis-server (Linux)"
    exit 1
fi

# Check if honcho is installed
if ! command -v honcho &> /dev/null; then
    echo "⚠️  Honcho is not installed. Installing..."
    pip install honcho
fi

# Check if virtual environment is activated
if [[ -z "$VIRTUAL_ENV" ]]; then
    echo "⚠️  No virtual environment detected. Activating .venv..."
    if [ -f ".venv/bin/activate" ]; then
        source .venv/bin/activate
    else
        echo "❌ Virtual environment not found at .venv/"
        echo "   Create it with: python -m venv .venv"
        exit 1
    fi
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Copying from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "   ✓ Created .env file. Please review and update it."
    else
        echo "❌ .env.example not found"
        exit 1
    fi
fi

echo "✓ Prerequisites checked"
echo ""
echo "Starting all services with honcho..."
echo "  - Django development server (port 8000)"
echo "  - Celery worker"
echo "  - Celery beat scheduler"
echo "  - Redis server (port 6379)"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Start all processes using honcho
# Try to find if any process is using port 8000 and kill it to resolve port conflict
PORT=8000
PID=$(lsof -ti tcp:$PORT)
if [ ! -z "$PID" ]; then
    echo "⚠️ Port $PORT is in use by process $PID. Stopping it..."
    kill -9 $PID
    echo "   Process on port $PORT stopped."
else
    echo "Port $PORT is free."
fi

honcho start
