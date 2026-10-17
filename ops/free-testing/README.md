# HMS free solo-testing deployment

Status: Oracle origin, public HTTPS/API, and scoped browser workflows verified
Owner: Operations
Last reviewed: 2026-10-15
Scope: synthetic data, public HMS login with existing accounts, $0 hosting target.

Use one Oracle Cloud Always Free Ubuntu ARM64 VM for the complete Rust V2
Compose stack, with Cloudflare Tunnel on `staging.thehms.systems`. The default
requires Cloudflare Access; explicit `--public` mode uses HMS login alone.
Postgres, PgBouncer and Redis run on the VM; this path does not need Cloud SQL
or a paid load balancer. The existing domain's renewal remains a separate cost.
The wrapper participates in the same host-wide deployment lease as GCP,
standalone Compose and archive installs, retaining it through tunnel changes.
Python 3 and the private canonical lease under `/opt/.hms-deploy-state/` are
required; unsafe ownership or a pre-existing legacy deployment lock fails closed.
See the [runtime schema compatibility contract](../../docs/v2/2026-10-17-runtime-schema-compatibility-scope.md).

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

The kit must be present in the reviewed remote commit/branch before cloning
it on the VM. Commit and push that reviewed revision from the operator checkout
first, then verify the remote branch and select that exact revision on the host.
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

The factor-authentication rollout changes privileged sign-in: the bootstrap
password alone returns a restricted setup grant, without an ordinary session.
Run the migrator's aggregate `auth-readiness` command in the private migration
environment and arrange named-user operator bootstrap plus real passkey
registration and a separate assertion. Raw bootstrap tokens belong only in new
private files and the reviewed delivery channel. Never automatically enroll a
test signer onto the tester's normal account. Existing enrolled accounts require
their existing factor. Readiness, a password response, or a pushed build cannot
replace authenticated browser acceptance. See the
[authentication policy](../../docs/v2/2026-10-17-authentication-policy.md) and
[operator commands](../../backend-rs/crates/hms-migrator/README.md).

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

### Trusted client provenance

The synthetic profile separates the Caddy-to-API link from the
connector-to-Caddy link. Each proxy has one explicit static peer; the API trusts
only those two `/32` addresses. It does not trust the shared frontend network,
all private addresses, or caller-supplied offsite/client-IP flags. The API port
remains unpublished. Select non-overlapping private Docker subnets before the
first deployment, using the six `HMS_*_PROXY_*` settings in the private file.
Existing private files use the documented defaults. Changing subnets requires
recreating the affected containers/networks during a planned update; preserve
database volumes and rollback config. Do not use `down -v`.

Caddy trusts only the dedicated connector peer and preserves the complete
`X-Forwarded-For` chain. Cloudflare appends its observed connecting address at
the right; the API validates the entire bounded chain and resolves from the
right through explicit proxy hops. Missing, malformed and entirely trusted
chains cannot establish an onsite client. Direct Caddy connections ignore
caller-supplied forwarding headers. `CF-Connecting-IP`, `X-Real-IP`, `Forwarded`
and `X-HMS-Offsite` are stripped before the API. This follows the
[Caddy proxy trust contract](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults),
[strict right-to-left parsing](https://caddyserver.com/docs/caddyfile/options#trusted_proxies_strict)
and [Cloudflare forwarding behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/#x-forwarded-for).
Do not add a Worker/CDN/alternate ingress that changes this chain without
reviewing and retesting provenance. An SSH local forward exposes the forwarding
endpoint, not the operator's original Tailscale address.

Facility onsite CIDRs are a separate, explicitly bootstrapped policy. Container
proxy addresses are never facility onsite defaults. An unconfigured policy or
unknown connection permits no clinical writes, even with fresh credentials.
Publish the initial policy through the reviewed operator CLI before expecting
write access; do not widen onsite ranges to make a smoke test pass.

For bootstrap or an operator recovery, prepare a private review-reason file and
retain one UUID with the exact original options. Read the current policy version
first; a new facility uses version zero. Supply reviewed facility onsite CIDRs
and the chosen offsite mode explicitly, then run the migrator command inside the
existing merged Compose kit:

```bash
docker compose --env-file ops/free-testing/.env \
  -f ops/compose-v2/compose.yml -f ops/free-testing/compose.yml \
  run --rm -T hms-migrator hms-migrator configure-network \
  --facility-code FACILITY_CODE \
  --onsite-cidr REVIEWED_ONSITE_CIDR \
  --offsite-mode readonly \
  --expected-version CURRENT_VERSION --request-id RETAINED_UUID \
  --reason-stdin < /private/path/network-policy-reason.txt
```

Replace every uppercase argument deliberately; add `--onsite-cidr` for each
reviewed range. `readonly`, `deny` and `fresh_reauth` are supported offsite modes;
fresh credential confirmation is not strong MFA. Universal ranges, implicit
facility defaults and new UUIDs for uncertain retries are not accepted. The CLI
uses the same transactional version/replay/history/audit contract as the API.
It prints only version, range count and replay status. It does not mark the
operator's observed connection onsite or establish original Tailscale provenance.

Gateway failure logs retain status/error diagnostics and remove the request
object, including clinical URI, headers and client address. Local frontend
proxy failures are similarly redacted; verify with `npm run test:proxy-privacy`.

## 3. Protect the domain, then connect the tunnel

### Public login page (explicit opt-in)

For an openly reachable login page, omit the Access application and leave
`HMS_TEST_ACCESS_TEAM_DOMAIN` blank. Create the Tunnel and configure its token
and `staging.thehms.systems` route to `http://caddy:80` as below, but leave
**Protect with Access** disabled. Publish DNS only after the local stack passes
readiness and anonymous `/api/v2/auth/me` and `/api/v2/patients` requests return
401. Run `ops/free-testing/deploy.sh --public` to check these authentication
requirements locally before starting the connector and again over HTTPS.
Public reachability does not enable registration or account-setup email;
users still need individual HMS accounts. Keep bootstrap credentials private.
Do not expose database, metrics, ops or application container ports.
To remove public access, stop only `cloudflared` using the merged Compose
configuration and tunnel profile. Existing local services and volumes remain.

### Access-protected deployment (default)

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
DNS records. Follow the verification evidence below to distinguish local
preparation from the subsequent live deployment.

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

The initial ops suite passed: 79 tests in the working checkout and the clean-checkout-only
GCP dry-run test in an isolated clean checkout. The deployment security review
found no material issue.

On 2026-10-14, the Oracle Casablanca ARM64 origin and the remotely managed
Cloudflare Tunnel were deployed. `staging.thehms.systems` now uses the tunnel
instead of its former GCP A record; a private copy of the prior DNS record and
VM configuration was retained for rollback. There is no Cloudflare Access gate.
The public-mode ops tests passed (14 tests). Public HTTPS checks returned 200
for the home/login pages, frontend JavaScript, readiness, administrator login,
authenticated identity, bounded registry and dashboard. Anonymous identity and
patient-list requests returned 401; metrics and ops returned 404. The tunnel
reported healthy with four connections. Administrator credentials remain private.
The application image is from `8a820c09b`; public-mode deployment scripts are
from `57d91d300`. Public self-registration remains unimplemented. At that point,
interactive browser workflows, passkeys, WebSockets and remote latency were unverified.
This runbook is a testing deployment path, not production or clinical approval.

On 2026-10-15, code release `88f800ccb18c5f324b130b875e763895ccff3a5c` was
pushed and deployed from a checksum-verified Git archive. Native ARM64 Rust 1.88
and frontend images built successfully. Both phase migrations applied; API,
worker, frontend, gateway, and tunnel checks passed, and runtime build identity
matches the archived release. Private source/environment/database/image rollback
anchors were retained before each phase replacement. DNS and paid resources
were unchanged.

Public readiness returns 200; anonymous identity/registry return 401; metrics
and ops routes return 404. Authenticated registry, Chronicle, dashboard,
templates, and synthetic medication create/update/stop pass. A public browser
also verified login, registry, prescription create/stop and active-summary
refresh. Laptop/mobile layout, navigation-sheet closure and persisted dark
appearance passed scoped checks. A 100-request origin read smoke at concurrency
five had no failures (p50 4.30 ms, p99 9.14 ms); it excludes edge/client latency
and does not establish capacity. Passkey enforcement and continuous realtime
remain incomplete. See the full [phase evidence](../../docs/v2/2026-10-15-phase-one-verification.md)
for local test counts, security/performance scope, and remaining feature gaps.
