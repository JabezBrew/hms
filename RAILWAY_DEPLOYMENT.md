# Deploying HMS to Railway

Railway is the fastest way to get HMS to production. No Kubernetes knowledge required.

## Quick Start (15 minutes)

### 1. Install Railway CLI

```bash
# macOS
brew install railway

# or npm
npm install -g @railway/cli

# Login
railway login
```

### 2. Create Project

```bash
cd /Users/jebre/Desktop/hms
railway init
```

### 3. Add Services via Railway Dashboard

Go to [railway.app](https://railway.app) and add these services to your project:

#### PostgreSQL (Database)
- Click "New" → "Database" → "PostgreSQL"
- Railway auto-creates `DATABASE_URL`

#### Redis (Cache/Celery)
- Click "New" → "Database" → "Redis"
- Railway auto-creates `REDIS_URL`

#### Backend API
- Click "New" → "GitHub Repo" → Select your repo
- Set root directory: `backend`
- Add environment variables (see below)

#### Frontend
- Click "New" → "GitHub Repo" → Select your repo
- Set root directory: `frontend`

#### Celery Worker
- Click "New" → "GitHub Repo" → Select your repo
- Set root directory: `backend`
- Override start command: `celery -A hms_backend worker -l info`

#### Celery Beat
- Click "New" → "GitHub Repo" → Select your repo
- Set root directory: `backend`
- Override start command: `celery -A hms_backend beat -l info`

### 4. Environment Variables

Set these for the **Backend API** service:

```bash
# Railway auto-injects these from your database services:
# DATABASE_URL=postgresql://...
# REDIS_URL=redis://...

# You need to add:
DJANGO_SETTINGS_MODULE=hms_backend.settings
SECRET_KEY=your-secret-key-here
ALLOWED_HOSTS=*.railway.app,yourdomain.com
CORS_ALLOWED_ORIGINS=https://your-frontend.railway.app,https://yourdomain.com
DEBUG=false

# Parse DATABASE_URL for Django
DB_NAME=${DATABASE_URL}
```

Set these for the **Frontend** service:

```bash
VITE_API_URL=https://your-backend.railway.app
```

### 5. Deploy

Railway auto-deploys on git push. Or manually:

```bash
railway up
```

## Railway Project Structure

```
Railway Project: hms
├── PostgreSQL (database)
│   └── Auto-provisioned, managed backups
├── Redis (cache)
│   └── Auto-provisioned
├── hms-api (backend)
│   ├── Dockerfile: docker/Dockerfile.backend
│   ├── Replicas: 2-10 (auto-scaling)
│   └── Health check: /api/health/
├── hms-frontend (frontend)
│   ├── Dockerfile: docker/Dockerfile.frontend
│   └── Replicas: 2
├── hms-celery (worker)
│   ├── Same image as API
│   └── Command: celery worker
└── hms-celery-beat (scheduler)
    ├── Same image as API
    └── Command: celery beat
```

## Cost Breakdown

| Service | Estimated Cost |
|---------|---------------|
| PostgreSQL | $15-30/mo |
| Redis | $10-20/mo |
| API (2 replicas) | $20-50/mo |
| Frontend (2 replicas) | $10-20/mo |
| Celery Worker | $10-20/mo |
| Celery Beat | $5-10/mo |
| **Total** | **~$70-150/mo** |

*Based on Railway's usage-based pricing. Scales with traffic.*

## CLI Commands

```bash
# Check status
railway status

# View logs
railway logs

# Open dashboard
railway open

# Run database migrations
railway run -s hms-api python manage.py migrate

# Create superuser
railway run -s hms-api python manage.py createsuperuser

# Connect to database shell
railway connect postgres
```

## Custom Domain

1. Go to your service in Railway dashboard
2. Click "Settings" → "Domains"
3. Add your domain (e.g., `api.yourdomain.com`)
4. Add the CNAME record to your DNS
5. Railway auto-provisions SSL

## Scaling

Railway auto-scales based on CPU. Configure in dashboard:

- **Min replicas**: 2 (for availability)
- **Max replicas**: 10 (cost control)
- **CPU threshold**: 70%

Or in `railway.toml`:

```toml
[deploy.scaling]
minReplicas = 2
maxReplicas = 10
cpuThreshold = 70
```

## Monitoring

Railway provides built-in:
- ✅ Request logs
- ✅ Deployment logs
- ✅ Metrics (CPU, Memory)
- ✅ Health check status

For advanced monitoring, add:
- Sentry (error tracking)
- Axiom (log aggregation - Railway integration available)

## Comparison: Railway vs Kubernetes

| Feature | Railway | Your K8s Setup |
|---------|---------|----------------|
| Deploy time | 15 min | 1-2 hours |
| Learning curve | Low | High |
| Auto-scaling | ✅ | ✅ |
| Custom domains | ✅ | ✅ (with cert-manager) |
| Managed DB | ✅ Built-in | ❌ Need to add |
| CI/CD | ✅ Built-in | ❌ Need GitHub Actions |
| Cost (small) | ~$100/mo | ~$200/mo |
| Cost (scale) | ~$300/mo | ~$400/mo |
| Vendor lock-in | Medium | Low |
| Customization | Limited | Full |

## When to Use Railway

✅ **Good for:**
- Startups/MVPs
- Small-medium teams
- Fast iteration
- Limited DevOps resources

❌ **Consider Kubernetes instead if:**
- Enterprise compliance requirements
- Need custom networking (VPCs, VPNs)
- Multi-region deployment
- Cost optimization at scale (>$500/mo)

## Migration Path

Start with Railway, migrate to Kubernetes later if needed:

1. Railway for MVP/early stage
2. Export data from Railway PostgreSQL
3. Import to managed RDS/Cloud SQL
4. Deploy K8s manifests (you already have them)

Your code doesn't change - just the infrastructure.
