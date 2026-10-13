# HMS free solo-testing deployment

Status: prepared; no live deployment verified
Owner: Operations
Last reviewed: 2026-10-13
Scope: synthetic data, one tester, $0 hosting target.

Use one Oracle Cloud Always Free Ubuntu ARM64 VM for the complete Rust V2
Compose stack, with Cloudflare Tunnel and Access on `staging.thehms.systems`.
Postgres, PgBouncer and Redis run on the VM; this path does not need Cloud SQL
or a paid load balancer. The existing domain's renewal remains a separate cost.

## 1. Obtain the host

Choose `VM.Standard.A1.Flex`, **2 OCPUs / 12 GB RAM**, an Always Free eligible
Ubuntu ARM64 image, and an **80–100 GB boot disk** in the account's **home
region**. Keep all boot/block volumes combined within **200 GB**, and confirm
the console labels every selected resource Always Free eligible before
creating it. These are the limits in
[Oracle's current Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
checked on 2026-10-13.

Capacity can be unavailable in the chosen region; Oracle may reclaim idle
instances after a seven-day low-utilization period. Keep a private copy of any
synthetic test state worth preserving. Do not upgrade or choose a paid shape to
work around capacity without reviewing its cost. Oracle signup requires card
verification; the free tier has no SLA.
[Oracle Free Tier FAQ](https://www.oracle.com/cloud/free/faq/).

Install Git, Python 3, Docker Engine and its Compose plugin using
[Docker's current Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
The override uses Compose tags requiring **Compose 2.24.4 or newer**. Allow SSH
only from your operator address. Do not open inbound web or database ports;
the tunnel carries web traffic outbound from the host.

If Oracle has no capacity, the same kit can run on an existing computer with
Docker. That computer must remain running and connected for remote access;
electricity and Internet costs still apply.

## 2. Prepare HMS privately

The new kit must be present in the reviewed remote commit/branch before cloning
it on the VM. Commit and push that reviewed revision from the operator checkout
first; no push or remote revision verification was performed during this
preparation. On the host, clone the repository and select that exact revision.
From its root:

```bash
git clone https://github.com/JabezBrew/hms.git
cd hms
git status --short
git rev-parse HEAD
python3 ops/free-testing/prepare-env.py \
  --domain staging.thehms.systems --admin-email YOUR_EMAIL
```

Alternatively, transfer a Git archive of the reviewed commit into a user-owned
`/opt/hms`. An archive has no `.git`, so set `HMS_BUILD_SHA` to that commit's
full SHA in the shell before running the deploy wrapper.

Replace `YOUR_EMAIL` with your tester email. The helper creates ignored
`ops/free-testing/.env` with mode `600` and unique database, JWT and bootstrap
admin secrets. It does not print secrets or overwrite an existing env file.
Inspect that file in a private editor to obtain your bootstrap login. Keep it
off Git, logs, screenshots and chat.

This profile uses `HMS_ENV=staging`, the `hospital` deployment profile, and a
small synthetic smoke dataset of 50 patients. Account-setup delivery is
disabled, so staff setup/reset email delivery is not available. Passkey origin
and RP ID use the chosen HTTPS domain. Keep real patient data out of this host.

Validate and deploy locally before publishing DNS:

```bash
docker compose --env-file ops/free-testing/.env \
  -f ops/compose-v2/compose.yml -f ops/free-testing/compose.yml config -q
ops/free-testing/deploy.sh --local-only
```

The wrapper uses the reviewed local checkout without pulling another revision,
runs the existing database/migration/application deploy, and checks Caddy
readiness at `127.0.0.1:8088`. The loopback listener is HTTP for local checks;
the eventual browser URL is HTTPS through Cloudflare.

## 3. Protect the domain, then connect the tunnel

In the Cloudflare account that owns `thehms.systems`:

1. Create a self-hosted Access application for the **entire** hostname
   `staging.thehms.systems`, with no path restriction. Add one Allow policy for
   **only your tester email** and choose a login provider or email one-time PIN.
   Create this protection before publishing the route. Keep HMS login enabled
   behind Access. Follow the
   [Access application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
2. Create a remotely managed Cloudflare Tunnel. In the private `.env` file,
   set `CLOUDFLARE_TUNNEL_TOKEN` to its token and
   `HMS_TEST_ACCESS_TEAM_DOMAIN` to your `my-team.cloudflareaccess.com` hostname
   (without `https://`). The kit runs the Docker connector; do not install a
   second host connector with the dashboard's sample command. Follow the
   [Tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/).
3. Record the existing staging A/AAAA/CNAME records privately for DNS rollback.
   Replace conflicting staging records only when the local stack is healthy.
   Publish exactly `staging.thehms.systems` to **`http://caddy:80`**, with no path
   restriction. `localhost` here would refer to the connector container.
4. In that route's origin settings, enable **Protect with Access** and supply
   the Access team name and application Audience (AUD). This makes the
   connector validate Access before forwarding requests. Keep every alternate
   route protected or remove it. See
   [origin Access settings](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/#access).

Start or update the stack with the tunnel:

```bash
ops/free-testing/deploy.sh
```

Before changing Docker services, the default wrapper requires anonymous
requests to both `/` and `/api/v2/health/ready` to redirect to that Access team.
It then checks local origin readiness and the connector's `/ready` response;
it does not authenticate to the public application. The tunnel uses outbound
connectivity; use Cloudflare's
[connectivity prechecks](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/connectivity-prechecks/)
if a host firewall prevents it connecting. Preserve the rest of the domain's
DNS records. No VM, Cloudflare account, tunnel or Access configuration has been
created by this preparation.

## 4. Verify before calling it live

Check containers and the protected domain:

```bash
docker compose --env-file ops/free-testing/.env \
  -f ops/compose-v2/compose.yml -f ops/free-testing/compose.yml \
  --profile tunnel ps
```

Confirm the checkout SHA, successful migrator exit, healthy API/worker, and a
healthy tunnel. In the browser, sign in through Access and then HMS. Verify
`https://staging.thehms.systems/api/v2/health/ready`, patient registry,
Patient Chronicle, ward board and one synthetic workflow. Confirm an
unauthorized/incognito session is stopped by Access before HMS loads.

A redirect to the Access login page proves only that Access is responding;
it does not prove HMS readiness. The wrapper checks this protection and tunnel
connectivity separately. Authenticated browser readiness, login and workflow
smoke remain required before calling the deployment live.

## Stop, update and recover

Stop the stack while preserving its volumes:

```bash
docker compose --env-file ops/free-testing/.env \
  -f ops/compose-v2/compose.yml -f ops/free-testing/compose.yml \
  --profile tunnel stop
```

Do not use `down -v`. For an update, record the current SHA, preserve a private
backup of test state if needed, select the new reviewed revision, then run
`ops/free-testing/deploy.sh` again. Migrations can prevent code-only rollback;
use a matching database backup when required. Disconnecting the tunnel or
removing its published route stops public access; restoring old DNS does not
revive a stopped GCP/Hetzner deployment.

## Verification status

Local native ARM64 Docker validation passed: the Rust 1.88 release image and
frontend image built, fresh migrations and the 50-patient smoke seed completed,
and API, worker, frontend, Caddy, Postgres, Redis and PgBouncer became healthy.
Bootstrap login, authenticated identity, bounded patient registry, dashboard
and Patient Chronicle returned successful responses. Anonymous patient access
returned 401; metrics and ops routes returned 404. Caddy configuration validation,
frontend generated-client/build/bundle checks and Rust formatting also passed.

The ops suite passed: 79 tests in the working checkout and the clean-checkout-only
GCP dry-run test in an isolated clean checkout. The deployment security review
found no material issue. Oracle VM behavior, tunnel connection, authenticated public/browser smoke,
passkeys, WebSockets and remote latency remain pending. No remote host or domain
configuration was changed.
This runbook is a testing deployment path, not production or clinical approval.
