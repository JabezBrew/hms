# Offline ARM64 releases and storage limits

This path builds application images on the operator's Mac and runs finished
Linux ARM64 images on the Oracle synthetic testing host. It needs no registry
or GitHub Actions. The Rust API, worker and migrator share one image. GCP and
the existing source-build Compose deployment remain separate entry points.

The bundle is an operator-produced artifact, not a signed software supply-chain
attestation. Transfer checksums detect corruption. Use a trusted builder and
trusted SSH host identity. Never bypass an SSH host-key mismatch to deploy.

## Build a reviewed commit locally

Complete local checks and commit first. The producer refuses tracked changes,
local Git archive overrides, incomplete source archives, non-ARM64 application
images and an existing output directory. Untracked/private files are excluded.
It builds the exact Git archive, rather than the operator's working directory.

```sh
revision="$(git rev-parse HEAD)"
python3 ops/free-testing/build-release.py \
  --revision "$revision" --output "/private/tmp/hms-release-$revision"
```

The default local preflight requires a 24 GiB build budget plus 16 GiB free
reserve. These are conservative admission budgets, not a prediction of build
peak usage. Docker Desktop's Linux VM also needs sufficient allocated space.
The producer never prunes a builder or changes global Docker configuration.
Every build explicitly selects an inspected, running local Docker-driver
builder for the verified Unix-socket context. Ambient builder overrides are
rejected; a persisted remote default cannot redirect compilation to Oracle.
Keep one Cargo build job on the 18 GiB Mac. A failed build leaves no accepted
manifest; do not transfer a partial bundle. Preserve its failed-check evidence.

The completed directory contains `manifest.json`, `source.tar.gz` and
`images.tar.gz`. The manifest binds full commit SHA, runtime schema epoch,
archive checksums/sizes, platform, canonical image config digests and actual
Docker image object identities. Docker stores may report either a config or
manifest digest as the object ID; server verification binds both before pinning
the actual local ID. An image config ID is not a registry RepoDigest. Frontend static build information and
`/build-info.json` carry the same full commit.

## Transfer and stage without replacing the previous release

After verifying the SSH target, transfer the whole completed directory to a
private operator-owned bundle directory. Do not put credentials in it. Prepare
an operator-owned, non-group-writable `/opt/hms-releases` parent. Use this
reviewed tool version to stage a fresh source tree:

```sh
python3 /opt/hms/ops/free-testing/stage-release.py \
  --bundle "/opt/hms-bundles/$revision" \
  --destination "/opt/hms-releases/$revision"
```

Staging verifies transfer checksums and Git archive identity, rejects links,
special files, duplicate names and path traversal, normalizes executable modes,
and checks the resulting bytes and schema declaration. It refuses an existing
destination. It does not load images or touch running services. Keep the prior
tree, manifest and images as recovery anchors. An older installation without
these scripts must first obtain this reviewed tooling; there is no remote
download-and-execute bootstrap.

Keep the existing private environment outside versioned source trees and pass
its absolute path. It must still satisfy `prepare-env.py --check`; do not
generate new credentials over an existing installation. On the Linux host:

```sh
cd "/opt/hms-releases/$revision"
ENV_FILE=/opt/hms-private/free-testing.env \
  sh ops/free-testing/deploy.sh --public \
  --prebuilt-bundle "/opt/hms-bundles/$revision"
```

Omit `--public` to retain Cloudflare Access, or use `--local-only` for loopback
validation without a tunnel. Public mode still verifies anonymous API denial.
Do not route this bundle through the GCP archive installer or its legacy build
recovery path.

## Deployment admission and recovery

The canonical host lease covers preparation, migration and tunnel changes.
Prebuilt schema fences and deployment-attempt state live under
`/opt/.hms-deploy-state/prebuilt/hms-free-test`, outside every release tree.
Caller redirection is refused. Known legacy state in the selected tree or prior
`/opt/hms` install is conservatively copied: the highest observed fence and any
quiescing intent survive. Original files remain untouched. Unknown or unsafe
state requires review before services change.
Once this project's persistent prebuilt fence, attempt or current release exists,
the source-build entry point is refused too. Omitting the bundle flag cannot
bypass adoption or restart an older unpinned runtime. Other Compose projects
retain their existing source-build path.
Before infrastructure changes, the verifier checks exact source bytes/modes,
schema declaration, Linux ARM64 host/engine, image-archive identity, private
configuration and disk budgets. Infrastructure images for the selected profile
must already exist locally with the correct platform; preparing/updating those
images is a separate reviewed operation. There is no implicit infrastructure
pull during a prebuilt deployment.

The final Compose override removes every application `build` mapping, pins all
active services to inspected full image IDs, fixes runtime commit identity and
sets `pull_policy: never`. `up` also uses `--no-build --pull never`; one-shot
`run` uses `--pull never --no-deps` because Compose `run` has no `--no-build`.
The effective private configuration is checked before any transition. Missing
images, mismatched provenance, ambient profile/configuration conflicts and
unsupported Compose merge semantics refuse deployment. There is no compile or
pull fallback.

Backup, authoritative database schema probes, durable quiescing intent, writer
drain, migration fences and post-migration readiness remain required. A second
disk check runs after the backup and before writer quiescence. Actual containers
and frontend HTTP build identity are checked after startup. Container health by
itself does not prove which frontend was served.

Failure after quiescence can leave writers stopped. Preserve the candidate and
previous source/images, attempt state, schema fence and database backup. Use the
candidate migrator to establish the actual committed database epoch. Restart a
previous prebuilt release only when its runtime is compatible with that epoch,
using its own full SHA, manifest and verified images. Incompatible or unknown
state requires compatible-forward recovery or a separately reviewed database
restore. Never invent a rollback SHA, build on the server, or automatically
restore a database to make an older runtime start.

## Capacity policy

Measure every filesystem involved, including Docker, source/transfer storage and
the backup directory. Admission includes incoming image expansion, temporary
archives, source staging, a backup budget, migration working space and a free
database reserve. Defaults and controls are implemented in
`ops/prebuilt_release.py`: `HMS_DEPLOY_RESERVE_GIB` (10),
`HMS_DEPLOY_BACKUP_BUDGET_GIB` (4) and
`HMS_DEPLOY_MIGRATION_BUDGET_GIB` (2). Set a larger backup budget when two dump
copies exceed it; off-server verification reads back the complete snapshot.
Do not lower reserves merely to make an overfull host pass.

On a Linux containerd image store, set `HMS_CONTAINERD_ROOT` in the private env
from the reviewed actual daemon/containerd configuration. Docker's data root
does not establish the containerd image filesystem. The verifier requires a
real canonical directory and measures it separately, combining budgets only
when the paths share a filesystem. An absent reviewed root or unknown storage
driver refuses deployment. The supplied root is an operator attestation, not
automatic discovery. Classic overlay2 uses `DockerRootDir`. See
[Docker daemon storage configuration](https://docs.docker.com/engine/daemon/)
and [containerd image storage](https://docs.docker.com/engine/storage/containerd/).

Treat 70% used as a capacity warning and 85% as urgent. Deployment admission
refuses a projected filesystem at or above 85% used or
below its free reserve. Incoming layers use decompressed storage budgets with
additional overhead, rather than relying on a compressed engine image size.
This is a deploy-time guard; the synthetic profile
disables monitoring sidecars, so it does not establish a continuously delivered
disk alert. Monitor the real host separately if continuous alerts are required.

Container logs remain 10 MB × three files per container. Prometheus, when
enabled in other Compose shapes, has both time and size retention. Backups use
private atomic validated dumps and verified receipts, with count/age/byte
limits and a protected minimum. Retention is dry-run by default. Production
cleanup requires a successful encrypted off-server upload and exact readback
verification first. Deployment backup holds must be reviewed against migration
and recovery anchors before release; count/byte limits never erase a hold.
Admission happens before another dump is written. Dry-run mode counts physical
files; planned cleanup is not counted as free capacity. Explicit apply can
rotate an ordinary minimum member only after the new dump is verified. Backups
from another scope or off-server repository cannot satisfy the current minimum.
An incomplete attempt or orphan spool blocks further growth pending review.

The generic restore script refuses both transient and persistent prebuilt state
for this project. An explicit legacy-dump override cannot bypass that guard.
Use a separately reviewed recovery procedure with matching images, schema and
private configuration; an old unpinned migrator must not become the fallback.

Retain the current release and one verified schema-compatible rollback release.
The wrapper records successful local/public checks in the private release ledger
only after container and served frontend identity checks. Planning verifies both
retained bundle archives, source proof, locally available images and the current
running applications. An absent compatible rollback or a newer schema fence
prevents cleanup. No historical private environment is copied into the ledger:
preserve a private configuration snapshot separately before changing settings,
and validate it again for recovery.

Inspect a scoped image-retention plan under the host lease:

```sh
python3 ops/deploy-lease.py -- python3 ops/prebuilt_retention.py plan \
  --root "$PWD" \
  --state /opt/.hms-deploy-state/prebuilt/hms-free-test/releases
```

After reviewing its exact `digest`, apply that same plan:

```sh
python3 ops/deploy-lease.py -- python3 ops/prebuilt_retention.py apply \
  --root "$PWD" \
  --state /opt/.hms-deploy-state/prebuilt/hms-free-test/releases \
  --plan-digest REVIEWED_EXACT_DIGEST --apply
```

Apply recomputes the plan and checks every image/container reference again.
Only exact recorded obsolete HMS transport tags with exclusive ownership are
eligible; foreign tags or digest references, current/rollback identities and any
container use remain protected. No force removal is used. Shared or ambiguous
references can intentionally retain extra images.
Docker may automatically record an owned repository digest even for a local
build/load. Only the same recorded HMS repository and a manifest-proven digest
are accepted; a foreign namespace or digest never acquires cleanup authority.

Keep additional failed or incompatible recovery artifacts until their role is
resolved. Scope any image deletion to exact recorded HMS identities. Do not
run `docker system prune`, volume prune, global builder prune or recursive
source-tree cleanup. Transfer archives and old on-server build caches require
their own measured ownership inventory; this tooling does not infer ownership
from Docker's aggregate "reclaimable" number.

Locally, preserve source, lockfiles, accepted binaries, logs and receipts before
removing named rebuildable checkpoint targets. Cargo caches grow again. This
producer currently requires the local Docker-driver builder. Its GC policy is a
shared daemon concern and must be reviewed across applications before changing
it. A future dedicated BuildKit builder needs its own reviewed local-endpoint
validation and retention policy; this workflow does not silently reconfigure a
shared builder. See
[Docker cache garbage collection](https://docs.docker.com/build/cache/garbage-collection/).

Oracle's Always Free allocation is a combined 200 GB of eligible boot and block
volumes in the tenancy's home region. Budget across applications and servers;
do not assume 200 GB per VM. Confirm account eligibility and actual capacity in
the console. See [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
