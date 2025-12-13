# HMS Production Deployment Checklist

## Pre-Deployment

### 1. Container Registry Setup
Push your Docker images to a registry:

```bash
# Option A: Docker Hub
docker login
docker tag docker-api:latest yourusername/hms-api:v1.0.0
docker tag docker-frontend:latest yourusername/hms-frontend:v1.0.0
docker push yourusername/hms-api:v1.0.0
docker push yourusername/hms-frontend:v1.0.0

# Option B: Cloud Provider Registry (recommended)
# AWS ECR / GCP GCR / DigitalOcean Container Registry
```

### 2. Update k8s/secrets.yaml
Replace placeholder values with real secrets:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: hms-secrets
  namespace: hms
type: Opaque
stringData:
  DB_PASSWORD: "your-strong-password-here"
  SECRET_KEY: "your-django-secret-key-here"
  # Generate with: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

### 3. Update k8s/configmap.yaml
Set production values:

```yaml
data:
  DB_HOST: "your-managed-db-host.cloud.com"
  DB_NAME: "hms"
  DB_USER: "hms_user"
  REDIS_URL: "redis://your-managed-redis.cloud.com:6379/0"
  ALLOWED_HOSTS: "yourdomain.com,api.yourdomain.com"
  CORS_ALLOWED_ORIGINS: "https://yourdomain.com"
```

### 4. Update k8s/api-deployment.yaml
Replace image placeholder:

```yaml
image: yourusername/hms-api:v1.0.0  # Your actual image
```

## Infrastructure Requirements

### Managed PostgreSQL
- **Size**: 2 vCPU, 4GB RAM minimum
- **Storage**: 50GB SSD
- **Features needed**:
  - Automated backups
  - Point-in-time recovery
  - Read replica (for scaling reads)
  - Connection pooling (PgBouncer)

### Managed Redis
- **Size**: 1GB RAM minimum
- **Features needed**:
  - Persistence enabled
  - High availability (optional)

### Kubernetes Cluster
- **Nodes**: 3x (2 vCPU, 4GB RAM) minimum
- **Features needed**:
  - Metrics Server (for HPA)
  - Ingress Controller (nginx-ingress)
  - Cert-Manager (for HTTPS)

## Deployment Steps

```bash
# 1. Create namespace
kubectl apply -f k8s/namespace.yaml

# 2. Create secrets and config
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/configmap.yaml

# 3. Deploy services
kubectl apply -f k8s/services.yaml

# 4. Deploy applications
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/celery-deployment.yaml
kubectl apply -f k8s/ws-deployment.yaml
kubectl apply -f k8s/frontend-deployment.yaml

# 5. Setup autoscaling
kubectl apply -f k8s/hpa.yaml

# 6. Setup ingress (for external access)
kubectl apply -f k8s/ingress.yaml

# 7. Verify deployment
kubectl get pods -n hms
kubectl get hpa -n hms
```

## Post-Deployment

### Run Database Migrations
```bash
kubectl exec -n hms deployment/hms-api -- python manage.py migrate
```

### Create Superuser
```bash
kubectl exec -it -n hms deployment/hms-api -- python manage.py createsuperuser
```

### Seed Initial Data
```bash
kubectl exec -n hms deployment/hms-api -- python manage.py seed_test_users
kubectl exec -n hms deployment/hms-api -- python manage.py seed_default_templates
```

### Verify Health
```bash
# Check all pods are running
kubectl get pods -n hms

# Check HPA is working
kubectl get hpa -n hms

# Check logs
kubectl logs -n hms deployment/hms-api --tail=50

# Test endpoint
kubectl port-forward -n hms svc/hms-api 8000:80
curl http://localhost:8000/api/health/
```

## Monitoring Setup

### Install Prometheus + Grafana
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
```

### Key Metrics to Monitor
- Pod CPU/Memory usage
- HTTP request latency (P95, P99)
- Error rate (5xx responses)
- Database connection pool usage
- Redis memory usage

## Cost Estimates

| Provider | Small (Dev) | Medium (Prod) | Large (Scale) |
|----------|-------------|---------------|---------------|
| DigitalOcean | ~$100/mo | ~$250/mo | ~$500/mo |
| AWS | ~$200/mo | ~$400/mo | ~$800/mo |
| GCP | ~$150/mo | ~$350/mo | ~$700/mo |

*Includes: Kubernetes cluster, managed PostgreSQL, managed Redis, load balancer*

## Scaling Thresholds (from HPA config)

| Component | Min Pods | Max Pods | Scale-up Trigger |
|-----------|----------|----------|------------------|
| API | 3 | 10 | CPU > 70% |
| WebSocket | 2 | 5 | CPU > 70% |
| Celery | 2 | 4 | CPU > 80% |
| Frontend | 2 | 5 | CPU > 70% |

## Security Checklist

- [ ] HTTPS enabled (cert-manager + Let's Encrypt)
- [ ] Database not publicly accessible
- [ ] Secrets stored in Kubernetes Secrets (or external vault)
- [ ] Network policies restricting pod-to-pod traffic
- [ ] Pod security contexts (non-root user)
- [ ] Regular security updates on node images
