# Trusted network access policy

Status: implemented locally; release and deployment evidence belongs to the phase verification record.
Owner: Backend/Access and Operations Engineering
Last reviewed: 2026-10-16

## Boundary

Rust V2 determines network provenance from the real socket `ConnectInfo`, not
`x-hms-offsite`, `x-real-ip`, `CF-Connecting-IP`, or a browser-supplied onsite flag.
A direct untrusted peer cannot change its classification with forwarding headers.
Only peers explicitly covered by `HMS_TRUSTED_PROXY_CIDRS` may supply one bounded
`X-Forwarded-For` field. The complete chain must parse before the resolver walks
right to left past explicitly trusted hops. Missing socket identity, duplicate or
invalid-encoding fields, malformed/oversized chains, and all-trusted chains are
Unknown. The runtime trust default is empty. Each configuration accepts at most
64 explicit CIDRs and rejects an individual or combined universal address space.
IPv4-mapped IPv6 addresses are canonicalized consistently.

An unconfigured facility has read-only access, including for fresh administrators.
A configured policy supports `readonly`, `deny`, and `fresh_reauth` for known
offsite clients. Unknown never gains write access from fresh credentials. Under a
configured `deny` policy, Unknown also cannot read clinical or administrative
workflow data; malformed forwarding input cannot downgrade Deny into read access.
`fresh_reauth` uses the existing fifteen-minute authenticated credential evidence;
it does not assert strong MFA or a new authentication factor.

The central guard runs across the active route tree. GET/HEAD/OPTIONS follow read
policy; an exact list of existing POST search operations follows the same read
policy. Patient identity lookup remains a write because it persists a lookup
review. Exact credential/session/MFA lifecycle and health operations remain
available to authenticate, end a session, or secure the caller's own account.
PATCH `/auth/me` is a governed write. There is no general `/auth` prefix bypass.
Ops provider authentication remains independently required. Its configured
Cloudflare/Hybrid selection retains precedence over an unrelated Bearer token;
an invalid selected Cloudflare assertion cannot fall back to HMS authentication.
Schema, metrics, and Ops GET/HEAD reads are still subject to network policy.

## Operations

| Operation | Path | Contract |
| --- | --- | --- |
| `getAuthNetworkAccess` | GET `/api/v2/auth/network-access` | Current request decision, without addresses, CIDRs, or headers. |
| `getAdminNetworkPolicy` | GET `/api/v2/admin/network-policy` | Admin-only policy/current decision and eligibility to begin review. |
| `postAdminNetworkPolicyPreview` | POST `/api/v2/admin/network-policy/preview` | Fresh authorized admin previews canonical CIDRs and whether this actual connection stays onsite. No write. |
| `putAdminNetworkPolicy` | PUT `/api/v2/admin/network-policy` | Fresh authorized admin publishes a reviewed expected version with a stable request UUID and reason; returns the immutable saved snapshot. |

Preview is not authority to publish. Publication revalidates canonical CIDRs,
current server-derived client address, actor, facility/profile, auth versions,
session, and expected policy version. An admin candidate must retain this
connection as onsite. Deliberate bootstrap or recovery belongs to the explicit
operator command below.

For a new publication, the locked policy version must match both the submitted
CAS value and the version the server actually used to authorize this request.
A caller cannot guess a future version to overwrite a concurrent operator Deny
policy. The server-proof fence follows the existing immutable-receipt replay
branch; exact replay remains coherent after a later authorized policy change.
Explicit operator recovery retains its deliberate connection-policy exception.

A transaction locks facility, actor, exact current refresh session, request key,
and policy in that order. Actor/session locks serialize revocation and password
changes. The final proof deadline is capped by credential freshness, access-token
expiry, session deadlines, and the next effective authority boundary. Database
wall-clock checks after lock waits and before commit use an exclusive deadline;
a waiting update cannot outlive a grant that naturally expires without a version
increment. A stale actor/version and a reviewed-version conflict are definite
refusals. An unclassified storage/commit failure returns
`network_policy_write_unconfirmed`: callers preserve the exact request and do not
automatically create another change.

Request UUIDs are stored only as SHA-256 keys. Same actor/key/canonical payload
replay returns the original immutable policy snapshot even after another change.
A changed payload under the same key conflicts. Policy, immutable version,
command receipt, and minimal audit commit atomically. Audit metadata includes
version, mode, range count, and source; it excludes ranges, raw addresses,
forwarding headers, and the free-text review reason.

## Explicit operator bootstrap/recovery

Run migrations first. Supply the private database connection through the existing
operator environment; never copy it into command history or output. The command
has no implicit facility, onsite range, mode, version, request reference, or
review reason:

```text
hms-migrator configure-network \
  --facility-code FACILITY_CODE \
  --onsite-cidr REVIEWED_CIDR [--onsite-cidr REVIEWED_CIDR ...] \
  --offsite-mode readonly|deny|fresh_reauth \
  --expected-version REVIEWED_VERSION \
  --request-id RETAINED_UUID \
  --reason-stdin
```

Provide the bounded review reason on stdin. A new facility uses expected version
0. Explicit retries retain all original options, request reference, and reason.
Output confirms only saved version, range count, and replay status. This command
uses the same canonicalization, CAS, immutable receipt, and atomic audit path;
operator source has no fabricated user identity. An operator may deliberately
change access without the admin current-connection lockout requirement.

Trusted proxy runtime configuration is separate from facility onsite networks.
A proxy/container subnet must never be silently treated as onsite. The local
Compose/Caddy packet and its transport/header tests are documented in
`ops/free-testing/README.md`; this scope record does not claim external proxy
configuration or deployment has occurred.

## Query and verification boundaries

Protected requests perform one observed, indexed `network.policy.get` query with
no TTL decision cache, so changes take effect across AppState instances. Central
middleware carries the resolved request context into handlers. A warm protected
request therefore performs one durable auth-version read and one current policy
read, rather than resolving authentication twice. Production telemetry retains
its PHI-free metrics snapshot only in internal response extensions for contract
assertions; no diagnostic header or payload is added.

Focused tests cover actual HTTP header-bypass refusals, true unconfigured and
missing-peer fixtures, malformed/duplicate/invalid-encoding trusted chains,
Deny reads and read-only POST searches, freshness, exact auth exceptions,
canonical preview/persisted replay, unknown-write recovery, cross-instance policy
changes, and the production recorder's query budget. Repository tests cover
concurrent CAS/idempotency, lock-wait proof expiry, actor/version rejection,
lockout, and audit rollback. The actual operator binary is exercised against an
isolated Docker-backed database. Separate managed-permission/delegation HTTP
regressions hold the policy row until live authority expires. Full acceptance and
final counts are recorded by the release owner.
