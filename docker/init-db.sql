-- HMS Database Initialization
-- This script runs when the PostgreSQL container is first created

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE hms TO hms_user;
