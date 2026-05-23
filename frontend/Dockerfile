# Frontend Dockerfile
# Multi-stage build: Node for build, Nginx for serving
#
# The final image is runtime-configurable. It defaults to Rust V2 mode while
# retaining legacy API build args for explicit older deploy flows.

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .

# Runtime-config build arguments. Rust V2 is the default mode.
ARG VITE_API_BASE_URL
ARG VITE_HMS_API_MODE
ARG VITE_V2_API_BASE_URL
ARG VITE_WS_URL
ARG VITE_DEFAULT_FACILITY_CODE
ARG VITE_MULTI_FACILITY_MODE
ARG VITE_RUM_ENABLED
ARG VITE_OPS_DASHBOARD_HOSTS

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

ARG VITE_API_BASE_URL
ARG VITE_HMS_API_MODE
ARG VITE_V2_API_BASE_URL
ARG VITE_WS_URL
ARG VITE_DEFAULT_FACILITY_CODE
ARG VITE_MULTI_FACILITY_MODE
ARG VITE_RUM_ENABLED
ARG VITE_OPS_DASHBOARD_HOSTS

ENV API_BASE_URL=${VITE_API_BASE_URL} \
    HMS_API_MODE=${VITE_HMS_API_MODE} \
    V2_API_BASE_URL=${VITE_V2_API_BASE_URL} \
    WS_URL=${VITE_WS_URL} \
    DEFAULT_FACILITY_CODE=${VITE_DEFAULT_FACILITY_CODE} \
    MULTI_FACILITY_MODE=${VITE_MULTI_FACILITY_MODE} \
    RUM_ENABLED=${VITE_RUM_ENABLED} \
    OPS_DASHBOARD_HOSTS=${VITE_OPS_DASHBOARD_HOSTS}

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf.template

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Create startup script that substitutes runtime config and starts nginx
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'set -eu' >> /start.sh && \
    echo ': "${MULTI_FACILITY_MODE:=false}"' >> /start.sh && \
    echo ': "${RUM_ENABLED:=false}"' >> /start.sh && \
    echo ': "${API_BASE_URL:=/api}"' >> /start.sh && \
    echo ': "${HMS_API_MODE:=rust-v2}"' >> /start.sh && \
    echo ': "${V2_API_BASE_URL:=/api/v2}"' >> /start.sh && \
    echo 'sed "s/PORT_PLACEHOLDER/${PORT:-80}/g" /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf' >> /start.sh && \
    echo 'envsubst '"'"'${API_BASE_URL} ${HMS_API_MODE} ${V2_API_BASE_URL} ${WS_URL} ${DEFAULT_FACILITY_CODE} ${MULTI_FACILITY_MODE} ${RUM_ENABLED} ${OPS_DASHBOARD_HOSTS}'"'"' < /usr/share/nginx/html/runtime-config.js > /usr/share/nginx/html/runtime-config.js.tmp' >> /start.sh && \
    echo 'mv /usr/share/nginx/html/runtime-config.js.tmp /usr/share/nginx/html/runtime-config.js' >> /start.sh && \
    echo 'exec nginx -g "daemon off;"' >> /start.sh && \
    chmod +x /start.sh

# Expose port. Runtime can override with PORT, defaults to 80.
EXPOSE 80

# Start with our script
CMD ["/start.sh"]
