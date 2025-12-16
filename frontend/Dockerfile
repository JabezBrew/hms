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
COPY nginx.conf /etc/nginx/nginx.conf.template

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Create startup script that substitutes PORT and starts nginx
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'sed "s/PORT_PLACEHOLDER/${PORT:-80}/g" /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf' >> /start.sh && \
    echo 'exec nginx -g "daemon off;"' >> /start.sh && \
    chmod +x /start.sh

# Expose port (Railway sets PORT env var, defaults to 80)
EXPOSE 80

# Start with our script
CMD ["/start.sh"]
