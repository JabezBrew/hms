# Frontend Dockerfile
# Multi-stage build: Node for build, Nginx for serving
#
# The final image is runtime-configurable. Build args are retained only as
# compatibility defaults so the image can still boot in older deploy flows.

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .

# Compatibility build arguments for older deploy flows
ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ARG VITE_DEFAULT_FACILITY_CODE
ARG VITE_MULTI_FACILITY_MODE

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ARG VITE_DEFAULT_FACILITY_CODE
ARG VITE_MULTI_FACILITY_MODE

ENV API_BASE_URL=${VITE_API_BASE_URL} \
    WS_URL=${VITE_WS_URL} \
    DEFAULT_FACILITY_CODE=${VITE_DEFAULT_FACILITY_CODE} \
    MULTI_FACILITY_MODE=${VITE_MULTI_FACILITY_MODE}

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf.template

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Create startup script that substitutes runtime config and starts nginx
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'set -eu' >> /start.sh && \
    echo ': "${MULTI_FACILITY_MODE:=false}"' >> /start.sh && \
    echo ': "${API_BASE_URL:=/api}"' >> /start.sh && \
    echo 'sed "s/PORT_PLACEHOLDER/${PORT:-80}/g" /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf' >> /start.sh && \
    echo 'envsubst '"'"'${API_BASE_URL} ${WS_URL} ${DEFAULT_FACILITY_CODE} ${MULTI_FACILITY_MODE}'"'"' < /usr/share/nginx/html/runtime-config.js > /usr/share/nginx/html/runtime-config.js.tmp' >> /start.sh && \
    echo 'mv /usr/share/nginx/html/runtime-config.js.tmp /usr/share/nginx/html/runtime-config.js' >> /start.sh && \
    echo 'exec nginx -g "daemon off;"' >> /start.sh && \
    chmod +x /start.sh

# Expose port (Railway sets PORT env var, defaults to 80)
EXPOSE 80

# Start with our script
CMD ["/start.sh"]
