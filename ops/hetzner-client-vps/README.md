# HMS Client VPS Deployment Runbook

This kit deploys one HMS client per Hetzner VPS with Docker Compose, Caddy,
Postgres, Redis, the Django ASGI API, Celery worker/beat, and the Nginx-served
React frontend.

Default model: one VPS per client, one subdomain per client, one private `.env`
per client. Generated `.env` files and backup credentials are secrets and must
never be committed.

## Profiles and Modes

`DEPLOYMENT_PROFILE` controls the default product surface:

| Profile | Use case |
| --- | --- |
| `clinic` | Single-site outpatient clinic, leanest workflow set. |
| `hospital` | Single hospital with inpatient and outpatient workflows. |
| `hospital_network` | Multi-facility network with cross-facility features. |

`DEPLOYMENT_MODE` controls operational defaults:

| Mode | Use case |
| --- | --- |
| `demo` | Cheap staging/demo; local dumps are allowed. |
| `production` | Real client; encrypted off-server restic backups are required. |

Feature profile defaults can still be fine-tuned at runtime in
`Settings -> Feature Entitlements`.

## 1. Create the VPS

Recommended Hetzner baseline for staging or a small first client:

- Type: `CX23`
- Image: Ubuntu LTS
- Location: closest practical Hetzner region
- Backups: optional for demo, recommended for production
- Volumes: leave empty unless the client already needs extra disk
- Placement groups: leave empty for one-server clients
- Labels: optional, e.g. `app=hms`, `client=acme`, `mode=production`

Attach a Hetzner firewall with inbound:

| Protocol | Port | Source |
| --- | --- | --- |
| TCP | `22` | Your current IP only |
| TCP | `80` | Any IPv4/IPv6 |
| TCP | `443` | Any IPv4/IPv6 |
| ICMP | all | Any IPv4/IPv6 |

## 2. Point DNS

For a client subdomain, add:

```text
TYPE:   A
HOST:   acme
ANSWER: <Hetzner server IPv4>
TTL:    300
```

This creates `acme.thehms.systems`. Do not delete old managed-hosting records
until the replacement VPS is healthy and you are ready to cut over.

Check DNS from the VPS:

```bash
getent hosts acme.thehms.systems
curl -4 ifconfig.me
```

The `getent` IP should match the Hetzner server IPv4.

## 3. Prepare the Server

SSH in as the deploy user, then install Docker and baseline tools:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git fail2ban ufw
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf '%s\n' "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin restic
sudo usermod -aG sudo deploy
sudo usermod -aG docker deploy
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Add swap on a CX23:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
printf '%s\n' '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Clone the repo:

```bash
sudo mkdir -p /opt/hms
sudo chown deploy:deploy /opt/hms
git clone git@github.com:JabezBrew/hms.git /opt/hms
cd /opt/hms
```

## 4. Generate the Client Environment

Create a fresh client:

```bash
python3 ops/create-client-deployment.py \
  --slug acme \
  --name "Acme Clinic" \
  --profile clinic \
  --mode production \
  --domain acme.thehms.systems \
  --facility-code ACME \
  --output ops/hetzner-client-vps/.env
```

The command prints the initial admin login once. Store that password in your
password manager before closing the terminal.

For the current staging VPS, migrate it into this generic kit without rotating
existing Docker volumes or core secrets:

```bash
python3 ops/create-client-deployment.py \
  --slug staging \
  --name "HMS Staging" \
  --profile hospital \
  --mode demo \
  --domain staging.thehms.systems \
  --facility-code MAIN \
  --compose-project hms-cx23-staging \
  --from-env ops/hetzner-cx23-staging/.env \
  --output ops/hetzner-client-vps/.env
```

The `--compose-project hms-cx23-staging` value is deliberate. It keeps the
existing Docker volumes attached to the renamed deployment kit.
The old staging `.env` is untracked; after `git pull`, it may still be present
at the old path. If it is not, restore it from the staging server backup before
running the migration command.

Validate the generated file:

```bash
grep CHANGE_ME ops/hetzner-client-vps/.env
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml config -q
```

For production, `CHANGE_ME` values in backup or email settings must be replaced
before the client is considered ready.

## 5. Deploy

For normal updates after the client `.env` exists, use the one-command deploy:

```bash
cd /opt/hms
ops/hetzner-client-vps/deploy.sh
```

That script runs `git pull --ff-only`, validates Compose, starts `db` and
`redis`, runs the production backup gate when `DEPLOYMENT_MODE=production`,
builds images, runs migrations, starts services, prints `ps`, and checks the
public readiness endpoint.

For a production first deploy, fill and verify restic settings before running
the script. If you intentionally need to bypass the production backup gate for
an empty first launch, use:

```bash
ops/hetzner-client-vps/deploy.sh --skip-backup
```

Manual deployment is still available for debugging:

Start Postgres and Redis first:

```bash
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml up -d db redis
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml ps
```

Build images:

```bash
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml build
```

Run migrations:

```bash
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml run --rm api python /app/run_migrations.py
```

Start everything:

```bash
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml up -d
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml ps
```

Expected healthy services: `db`, `redis`, `frontend`, `api`, `worker`, `beat`,
and `caddy`.

Network model:

- `edge`: public reverse-proxy path for Caddy, frontend, and API ingress.
- `egress`: outbound-only internet access for API and worker integrations such
  as Unosend.
- `internal`: isolated database/Redis network. It is marked `internal: true`,
  so containers attached only to this network cannot reach the internet.

Check the public health endpoint:

```bash
curl -i https://acme.thehms.systems/api/health/ready/
```

## 6. Production Backups

Demo mode keeps local dumps in `ops/hetzner-client-vps/backups/`.

Production mode requires encrypted off-server restic backups through
S3-compatible storage. Fill these in `.env`:

```text
RESTIC_REPOSITORY=s3:<endpoint>/<bucket>/<path>
RESTIC_PASSWORD=<strong repository password>
AWS_ACCESS_KEY_ID=<restricted backup key>
AWS_SECRET_ACCESS_KEY=<restricted backup secret>
BACKUP_RETENTION_DAYS=30
```

Run a backup:

```bash
ops/hetzner-client-vps/backup-postgres.sh
```

Production is incomplete until this works:

```bash
RESTIC_REPOSITORY="$(grep '^RESTIC_REPOSITORY=' ops/hetzner-client-vps/.env | cut -d= -f2-)" \
RESTIC_PASSWORD="$(grep '^RESTIC_PASSWORD=' ops/hetzner-client-vps/.env | cut -d= -f2-)" \
AWS_ACCESS_KEY_ID="$(grep '^AWS_ACCESS_KEY_ID=' ops/hetzner-client-vps/.env | cut -d= -f2-)" \
AWS_SECRET_ACCESS_KEY="$(grep '^AWS_SECRET_ACCESS_KEY=' ops/hetzner-client-vps/.env | cut -d= -f2-)" \
restic snapshots
```

## 7. Restore

Restores are destructive. Verify the client, dump, and maintenance window first.

```bash
RESTORE_CONFIRM=restore-acme ops/hetzner-client-vps/restore-postgres.sh \
  ops/hetzner-client-vps/backups/acme-20260428T210000Z.dump
```

After restore:

```bash
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml run --rm api python /app/run_migrations.py
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml up -d
curl -i https://acme.thehms.systems/api/health/ready/
```

## 8. Update an Existing Client

From `/opt/hms`:

```bash
ops/hetzner-client-vps/deploy.sh
```

## 9. Troubleshooting

Frontend health:

```bash
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml logs --tail=80 frontend
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml exec frontend wget -S -O - http://127.0.0.1/health
```

API health:

```bash
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml logs --tail=120 api
docker compose --env-file ops/hetzner-client-vps/.env -f ops/hetzner-client-vps/compose.yml exec api curl -i -H 'Host: acme.thehms.systems' http://127.0.0.1:8000/api/health/ready/
```

Caddy certificate issues usually mean DNS does not point at the VPS, ports
`80/443` are blocked, or `CLIENT_DOMAIN` is wrong.
