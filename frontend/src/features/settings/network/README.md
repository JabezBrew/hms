# Network access settings

Status: active source; release verification owned by the parent integration.

Route: `/settings/network-access`, with `admin.authority.manage`.

Contracts: `GET /auth/network-access`, `GET /admin/network-policy`,
`POST /admin/network-policy/preview`, `PUT /admin/network-policy` under `/api/v2`.

The Rust contract separates ordinary current-request status from privileged
facility network configuration. Ordinary status does not disclose addresses or
CIDR ranges. Operator bootstrap and trusted-proxy transport configuration are
not browser features.

The editor requires a fresh same-account/facility/profile credential confirmation,
server preview of canonical candidate networks and an explicit publication.
Publication rechecks the current connection and expected policy version on the
server; a successful preview does not authorize a later save. The existing
credential freshness contract does not prove fresh multi-factor authentication.

An unknown save freezes its UUID, expected version, networks, mode and reason.
Only an explicit same-request retry is offered, with a new password confirmation.
Confirmed immutable receipts remain visible if current-policy refresh fails.
Passwords live only in component state and are cleared after every attempt.

Query keys contain sanitized client scope; network draft text is never a key.
Scope and capability changes reset copied drafts. Normal token rotation during
password confirmation does not unmount the operation. All enforcement remains
server-authoritative; a banner is not a permission control.

The global boundary checks a current request before mounting clinical routes,
search or startup services. Failed status reads hide previously mounted clinical
content. A precise credential-expiry timer restricts the old decision and requests
fresh status even before the next 15-second visible-page poll. Read-only mode
shows an in-flow notice and a credential-confirmation action when applicable.

The V2 client preflight refuses workflow writes against an unknown, failed,
expired or mismatched boundary scope. Exact credential-lifecycle and read-POST
exceptions match the Rust middleware; identity lookup and policy writes remain
restricted. This preflight is a UX guard in addition to backend enforcement.
After a definitive HTTP401, a protected retry waits for current network proof in
the original authority scope. Transport refresh cannot refresh credential proof,
change the principal or overwrite a newer account's token.

Dispatched workflow writes reserve a bounded tab-session recovery marker before
fetch. Only salted fingerprints, a random marker/request key, a whitelisted
operation category, timestamps and hashed actor/resource scope are stored. Bodies,
clinical identifiers, addresses, passwords and tokens are not stored. Password
bodies are not fingerprinted. The wire body is captured once before asynchronous
fingerprinting and is also used for the definitive-401 retry.

Network loss, post-dispatch abort, invalid responses and generic unconfirmed
outcomes retain the marker across clinical unmounts, credential confirmation and
reload. New writes are refused until reviewed. An explicit original request can
retry only when the server contract supports its UUID and the canonical payload
and resource identity match. The exact telemetry ingestion operation is excluded
from recovery tracking; ordinary network access enforcement still applies.

Recovery is a manual review boundary. A successful related server response in the
same resource scope, started after the uncertainty, enables an explicit review
acknowledgment. It does not prove that a change saved, was absent, or that a history
is complete. Failed/unrelated/older in-flight reads do not enable acknowledgment;
reload or an authority transition requires a new related read. Storage corruption,
unavailability or a full unresolved ledger fails closed for new writes while
permitted reads remain available. Entries are not silently evicted or cleared on
login, logout, reauthentication or query success.

Known admission, patient and target-item resources must match the read. For a
create with no canonical target ID, a fresh related collection response in the
same actor/facility/profile scope can enable manual review, including an empty or
partial list. That is not evidence of absence or completion. Explicit aliases
connect PRN requests to medication records, NHIS batches/exports to claims, and
catalog corrections to the existing item reads.

Typed mutation adapters can re-mark the exact original marker through
nonenumerable local response metadata when a syntactically valid response fails
domain validation. Reviewed adapters cover network policy, fluid observations and
rules, appointment groups, governed standing requests, PRN dose requests,
prescription/MAR receipts, pharmacy supply, NHIS writes, catalog corrections,
emergency access grant creation/end and managed access revocation.
This is not a claim that every legacy adapter has complete response validation.
