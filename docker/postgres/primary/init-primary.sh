#!/bin/bash
set -e

# Create replication user
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER replicator WITH REPLICATION ENCRYPTED PASSWORD 'replicator_password';
EOSQL

# Configure pg_hba.conf for replication connections
cat >> "$PGDATA/pg_hba.conf" <<EOF

# Allow replication connections from replica
host replication replicator 0.0.0.0/0 md5
EOF

echo "Primary database configured for replication"
