# Hetzner CX23 Staging

This profile runs cheap fake-data HMS staging on one Hetzner CX23:

- Caddy terminates TLS and proxies traffic.
- The frontend container serves the React build.
- One Django ASGI container handles HTTP and WebSockets.
- One Celery worker runs with concurrency 1.
- One Celery beat scheduler runs periodic tasks.
- Postgres and Redis stay private on an internal Docker network.

Do not put real PHI here. This is a cost-controlled staging setup, not a high-availability production design.

## 1. Create The Server

Use Hetzner Cloud:

- Project: `hms-staging`
- Server type: `CX23`
- Image: `Ubuntu 24.04`
- Location: Germany or Finland for the lowest price
- Architecture: x86
- Firewall: allow `80/tcp` and `443/tcp` publicly; restrict `22/tcp` to your IP when possible
- Backups: off for cheapest staging

Point DNS at the server:

```text
A staging.example.com -> <server IPv4>
```

## 2. Prepare The Host

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git fail2ban
adduser deploy
usermod -aG sudo deploy
ufw default deny incoming
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
```

Install Docker Engine and the Compose plugin from Docker's official Ubuntu repository:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf '%s\n' "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy
```

Log out, then log in again as `deploy`.

## 3. Configure HMS

```bash
sudo mkdir -p /opt/hms
sudo chown deploy:deploy /opt/hms
git clone <repo-url> /opt/hms
cd /opt/hms
cp ops/hetzner-cx23-staging/env.example ops/hetzner-cx23-staging/.env
chmod 600 ops/hetzner-cx23-staging/.env
```

Edit `ops/hetzner-cx23-staging/.env` and replace every `CHANGE_ME` value.

Useful generators:

```bash
openssl rand -hex 64
openssl rand -base64 32
python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

Set these values to your staging hostname:

```bash
STAGING_DOMAIN=staging.example.com
ALLOWED_HOSTS=staging.example.com
CORS_ALLOWED_ORIGINS=https://staging.example.com
CSRF_TRUSTED_ORIGINS=https://staging.example.com
FRONTEND_URL=https://staging.example.com
PUBLIC_BASE_URL=https://staging.example.com
WEBAUTHN_RP_ID=staging.example.com
WEBAUTHN_ALLOWED_ORIGINS=https://staging.example.com
```

## 4. Build And Start

```bash
cd /opt/hms
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml build
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml up -d db redis
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml run --rm api python /app/run_migrations.py
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml up -d
```

Check health:

```bash
curl -i https://staging.example.com/api/health/ready/
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml ps
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml logs -f api
```

## 5. Deploy Updates

```bash
cd /opt/hms
git pull --ff-only
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml build
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml run --rm api python /app/run_migrations.py
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml up -d
```

## 6. Backup Or Snapshot

For cheap staging, prefer Hetzner snapshots before risky tests. For a quick local DB dump:

```bash
ops/hetzner-cx23-staging/backup-postgres.sh
```

This writes to `ops/hetzner-cx23-staging/backups/`, which is ignored by git. For any environment containing real data, use encrypted off-server backups instead.

## 7. Cost Control

To pause staging and keep paying for the server:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml down
```

For the lowest cost, create a Hetzner snapshot, then delete the server. Hetzner bills powered-off servers because resources remain reserved.
