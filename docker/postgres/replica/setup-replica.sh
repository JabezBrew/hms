#!/bin/bash
set -e

# Wait for primary to be ready
until PGPASSWORD=$POSTGRES_PASSWORD psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; do
    echo "Waiting for primary database to be ready..."
    sleep 2
done

echo "Primary is ready. Checking if replica needs initialization..."

# Check if data directory is empty or needs re-initialization
if [ -z "$(ls -A $PGDATA 2>/dev/null)" ] || [ ! -f "$PGDATA/standby.signal" ]; then
    echo "Initializing replica from primary using pg_basebackup..."

    # Clean data directory
    rm -rf $PGDATA/*

    # Create base backup from primary
    PGPASSWORD=replicator_password pg_basebackup \
        -h "$PRIMARY_HOST" \
        -U replicator \
        -D "$PGDATA" \
        -Fp -Xs -P -R

    # Create standby.signal to indicate this is a replica
    touch "$PGDATA/standby.signal"

    # Set permissions
    chmod 700 "$PGDATA"

    echo "Replica initialized successfully"
else
    echo "Replica data directory already initialized"
fi

# Start PostgreSQL
exec docker-entrypoint.sh postgres
