# Hetzner CX23 Staging

This profile runs cheap fake-data HMS staging on one Hetzner CX23:

- Caddy terminates TLS and proxies traffic.
- The frontend container serves the React build.
- One Django ASGI container handles HTTP and WebSockets.
- One Celery worker runs with concurrency 1.
- One Celery beat scheduler runs periodic tasks.
- Postgres and Redis stay private on an internal Docker network.

Do not put real PHI here. This is a cost-controlled staging setup, not a
high-availability production design.

## Target Setup

Recommended cheap staging shape:

```text
Provider: Hetzner Cloud
Server:   CX23
Image:    Ubuntu 24.04
Domain:   staging.thehms.systems
Repo:     git@github.com:JabezBrew/hms.git
Branch:   feature/improvements
Path:     /opt/hms
```

Leave these Hetzner options empty/off for cheap staging:

```text
Volumes:          empty
Backups:          off
Placement groups: empty
Cloud config:     empty
```

Add labels if desired:

```text
app=hms
env=staging
role=all-in-one
```

## 1. Create Local SSH Key

Run this on your Mac, not on the server:

```bash
ssh-keygen -t ed25519 -C "hms-staging" -f ~/.ssh/hms_staging
```

When asked for a passphrase, press `Enter` twice.

Print the public key:

```bash
cat ~/.ssh/hms_staging.pub
```

Copy the full line. It starts with `ssh-ed25519` and ends with
`hms-staging`.

## 2. Create Hetzner Firewall

In Hetzner Cloud Console, create a firewall named:

```text
hms-staging-firewall
```

Inbound rules:

```text
TCP 22    your-public-ip/32
TCP 80    Any IPv4 + Any IPv6
TCP 443   Any IPv4 + Any IPv6
ICMP      optional
```

To find your current public IP from your Mac:

```bash
curl -4 ifconfig.me
```

Use that value for SSH as `<your-public-ip>/32`.

Important:

- Restrict only SSH port `22` to your IP.
- Keep ports `80` and `443` public so users and Let's Encrypt can reach Caddy.
- Leave outbound rules empty/default unless you have a specific egress policy.

If your home/office IP changes later, SSH may stop working. Update the
firewall source for port `22` in Hetzner.

## 3. Create Hetzner Server

Create the server in Hetzner Cloud:

```text
Project:      hms-staging
Name:         hms-staging-1
Location:     Germany or Finland
Image:        Ubuntu 24.04
Type:         CX23
Architecture: x86
IPv4:         enabled
IPv6:         enabled is fine
Backups:      off
Firewall:     hms-staging-firewall
SSH key:      paste ~/.ssh/hms_staging.pub
```

After creation, copy the server IPv4 address. This guide calls it:

```text
SERVER_IP
```

## 4. Add DNS

Do not delete legacy hosting DNS records until the Hetzner deployment is healthy
and you are ready to move traffic.

For staging, add one DNS record:

```text
TYPE:   A
HOST:   staging
ANSWER: SERVER_IP
TTL:    300
```

For DNS providers that show `.thehms.systems` beside the host field, type only:

```text
staging
```

Verify DNS from your Mac:

```bash
dig +short staging.thehms.systems
```

It should eventually print `SERVER_IP`. DNS can take a few minutes.

## 5. First SSH Login

From your Mac:

```bash
ssh -i ~/.ssh/hms_staging root@SERVER_IP
```

If prompted to trust the host, type:

```text
yes
```

## 6. Prepare Ubuntu Host

Run these as `root` on the VPS:

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git fail2ban
adduser deploy
usermod -aG sudo deploy
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

When `adduser deploy` asks for a password, create one and save it. For the
name/phone prompts, press `Enter`.

Add swap:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
```

Install Docker Engine and the Compose plugin from Docker's official Ubuntu
repository:

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

Reboot after upgrades and Docker group changes:

```bash
reboot
```

Wait about 30 seconds, then reconnect as `deploy`:

```bash
ssh -i ~/.ssh/hms_staging deploy@SERVER_IP
```

Confirm Docker works:

```bash
docker --version
docker compose version
```

## 7. Add GitHub Deploy Key

Run this on the VPS as `deploy`:

```bash
ssh-keygen -t ed25519 -C "hms-staging-deploy" -f ~/.ssh/hms_staging_deploy
```

When asked for a passphrase, press `Enter` twice.

Print the deploy public key:

```bash
cat ~/.ssh/hms_staging_deploy.pub
```

Copy the full `ssh-ed25519 ... hms-staging-deploy` line.

In GitHub:

```text
JabezBrew/hms -> Settings -> Deploy keys -> Add deploy key
Title: hms-staging
Key: paste the public key
Allow write access: off
```

Configure the VPS to use that deploy key:

```bash
nano ~/.ssh/config
```

Paste:

```text
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/hms_staging_deploy
  IdentitiesOnly yes
```

Save with `Control+O`, `Enter`, then `Control+X`.

Fix permissions and test:

```bash
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

Expected result includes:

```text
Hi JabezBrew/hms! You've successfully authenticated, but GitHub does not provide shell access.
```

## 8. Clone HMS

Run this on the VPS as `deploy`:

```bash
sudo mkdir -p /opt/hms
sudo chown deploy:deploy /opt/hms
git clone --branch feature/improvements git@github.com:JabezBrew/hms.git /opt/hms
cd /opt/hms
```

Confirm the staging deployment files exist:

```bash
ls ops/hetzner-cx23-staging
```

Expected files:

```text
Caddyfile
README.md
backup-postgres.sh
compose.yml
env.example
```

## 9. Create Staging Environment

Run this on the VPS:

```bash
cd /opt/hms
cp ops/hetzner-cx23-staging/env.example ops/hetzner-cx23-staging/.env
chmod 600 ops/hetzner-cx23-staging/.env
```

Auto-fill the staging values:

```bash
python3 - <<'PY'
from pathlib import Path
import base64
import os
import secrets

path = Path("ops/hetzner-cx23-staging/.env")
text = path.read_text()

domain = "staging.thehms.systems"
admin_password = secrets.token_urlsafe(24)

replacements = {
    "staging.example.com": domain,
    "ops@example.com": "admin@thehms.systems",
    "admin@staging.example.com": f"admin@{domain}",
    "noreply@staging.example.com": f"noreply@{domain}",
    "CHANGE_ME_generate_with_openssl_rand_hex_64": secrets.token_hex(64),
    "CHANGE_ME_generate_with_openssl_rand_base64_32": base64.b64encode(os.urandom(32)).decode(),
    "CHANGE_ME_generate_urlsafe_base64_32_bytes": base64.urlsafe_b64encode(os.urandom(32)).decode(),
    "CHANGE_ME_generate_with_openssl_rand_hex_32": secrets.token_hex(32),
    "CHANGE_ME_generate_unique_staging_admin_password": admin_password,
    "CHANGE_ME_or_staging_dummy": "staging-dummy-sendgrid-disabled",
}

for old, new in replacements.items():
    text = text.replace(old, new)

path.write_text(text)
print("")
print("Staging admin login:")
print(f"Email: admin@{domain}")
print(f"Password: {admin_password}")
print("")
print("Save this password now. It will not be shown again.")
PY
```

Save the printed admin password somewhere private.

Validate that placeholders are gone:

```bash
grep CHANGE_ME ops/hetzner-cx23-staging/.env
grep staging.example.com ops/hetzner-cx23-staging/.env
```

The `CHANGE_ME` command may print the top comment from the file. It should not
print any actual environment variable value containing `CHANGE_ME`. The
`staging.example.com` command should print nothing.

Validate Compose:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml config -q
```

No output means the config is valid.

## 10. Confirm DNS On The VPS

Run:

```bash
curl -4 ifconfig.me
getent ahostsv4 staging.thehms.systems
```

The IP from `getent` must match the server IP from `curl`. If it does not,
wait a few minutes before starting Caddy/TLS.

## 11. Build And Start

Start Postgres and Redis first:

```bash
cd /opt/hms
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml up -d db redis
```

Check they are healthy:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml ps
```

Build the HMS images:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml build
```

Run migrations and bootstrap the admin/facility:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml run --rm api python /app/run_migrations.py
```

Start everything:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml up -d
```

Check status:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml ps
```

Expected state:

```text
api        Up ... healthy
frontend   Up ... healthy
db         Up ... healthy
redis      Up ... healthy
worker     Up
beat       Up
caddy      Up
```

## 12. Verify HTTPS

First HTTPS request can take a minute because Caddy may still be obtaining a
certificate.

Run from the VPS or your Mac:

```bash
curl -i https://staging.thehms.systems/api/health/ready/
curl -I https://staging.thehms.systems/
```

Expected API response:

```text
HTTP/2 200
```

Open:

```text
https://staging.thehms.systems/
```

Use the generated admin login:

```text
Email: admin@staging.thehms.systems
Password: generated during env setup
```

## 13. Deploy Updates

Run on the VPS:

```bash
cd /opt/hms
git pull --ff-only
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml build
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml run --rm api python /app/run_migrations.py
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml up -d
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml ps
```

## 14. Backups And Snapshots

For cheap fake-data staging, Hetzner backups can stay off.

Before risky work, take a manual Hetzner snapshot from the Cloud Console.

For a quick local Postgres dump:

```bash
cd /opt/hms
ops/hetzner-cx23-staging/backup-postgres.sh
```

This writes to:

```text
ops/hetzner-cx23-staging/backups/
```

That directory is ignored by git. For any environment containing real data, use
encrypted off-server backups instead.

## 15. Cost Control

To pause the app while still paying for the server:

```bash
cd /opt/hms
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml down
```

For the lowest cost:

1. Take a Hetzner snapshot.
2. Download/export anything needed from the VPS.
3. Delete the server.

Hetzner bills powered-off servers because resources remain reserved.

## Troubleshooting

### SSH Is Blocked

If SSH stops working, your public IP probably changed. In Hetzner Firewall,
update the source for `TCP 22` to your current IP:

```bash
curl -4 ifconfig.me
```

Use:

```text
new-ip-address/32
```

### Frontend Is Unhealthy

Check:

```bash
cd /opt/hms
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml logs --tail=80 frontend
docker inspect hms-cx23-staging-frontend-1 --format '{{json .State.Health}}'
```

The frontend healthcheck uses `127.0.0.1` so Alpine `wget` does not resolve
`localhost` to IPv6 `::1`.

### API Is Unhealthy

Check:

```bash
cd /opt/hms
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml logs --tail=120 api
docker inspect hms-cx23-staging-api-1 --format '{{json .State.Health}}'
```

Test readiness from inside the container:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml exec api curl -i -H 'Host: staging.thehms.systems' http://127.0.0.1:8000/api/health/ready/
```

The API healthcheck uses `127.0.0.1` and sends the `Host:
staging.thehms.systems` header so Django's `ALLOWED_HOSTS` remains strict.

### Caddy Does Not Start

Caddy depends on both `api` and `frontend` being healthy. Check them first:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml ps
```

Then inspect Caddy:

```bash
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml logs --tail=120 caddy
```

Common causes:

- DNS for `staging.thehms.systems` does not point to the VPS yet.
- Hetzner firewall blocks `80/tcp` or `443/tcp`.
- `STAGING_DOMAIN` in `.env` is wrong.

### Rotate The Staging Admin Password

If the generated staging password appears in a screenshot or shared log, rotate
it after the app is online:

```bash
cd /opt/hms
docker compose --env-file ops/hetzner-cx23-staging/.env -f ops/hetzner-cx23-staging/compose.yml exec api python manage.py changepassword admin@staging.thehms.systems
```
