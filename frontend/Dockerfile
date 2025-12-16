# Frontend Dockerfile for Railway deployment
# Multi-stage build: Node for build, Nginx for serving
#
# This Dockerfile is designed to be built from the frontend/ directory

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .

# Build arguments for environment configuration
ARG VITE_API_URL
ARG VITE_WS_URL

ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx configuration
COPY nginx.railway.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Railway uses PORT environment variable
# Create entrypoint script to substitute PORT at runtime
RUN echo '#!/bin/sh' > /docker-entrypoint.d/40-configure-port.sh && \
    echo 'envsubst "\$PORT" < /etc/nginx/conf.d/default.conf > /etc/nginx/conf.d/default.conf.tmp && mv /etc/nginx/conf.d/default.conf.tmp /etc/nginx/conf.d/default.conf' >> /docker-entrypoint.d/40-configure-port.sh && \
    chmod +x /docker-entrypoint.d/40-configure-port.sh

# Expose the port (Railway sets PORT env var)
EXPOSE ${PORT:-80}

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
