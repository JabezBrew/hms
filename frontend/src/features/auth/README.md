# Rust authentication and account security

Password login returns either a validated authenticated token or a restricted
factor/setup grant. Restricted grants and entered credentials remain in RAM;
they never become an AuthUser or enter browser storage. A new account login
first ends the prior server session. A failed logout prevents the new exchange.
Leaving, cancelling, switching facility or starting another attempt aborts the
old operation and prevents its late result from authenticating the browser.

First-key setup requires a facility administrator's one-time operator token.
Registration is followed by a separate genuine assertion. Recovery completes a
recovery sign-in, and never substitutes for a passkey-required privilege. Rust
does not expose the legacy TOTP workflow. A forced password change follows the
server's restricted authenticated state and requires another real sign-in after
the existing password-change operation revokes the session.

`api.js` uses a fixed prelogin route allowlist with the configured API origin,
JSON, credentials and AbortSignal. It sends no bearer or automatic refresh for
restricted grant exchanges. Authenticated assurance and key management use the
ordinary V2 transport. Enrollment, verification and network access are distinct
server facts. Security settings load bounded key metadata and live assurance;
one-time recovery codes stay local, remain visible after a refresh failure, and
are removed on scope change. Lost or malformed security writes are explicitly
unconfirmed and do not automatically repeat.

Same-session identity verification uses the generated ordinary password-confirmation
operation only when the current server says both passkey-required and
passkey-enrolled are false. It sends exact password bytes in the current session
without refreshing, logging in again or falling back after failure. Enrolled or
privileged accounts retain assurance options/verify and an existing passkey.
Password confirmation is explicit; passkey-only proof cannot renew its timestamp. A coarse opaque factor-required signal offers a manual ceremony and
never retries the denied clinical/admin mutation. Security and signal scopes
always use the strict current request identity.

## Clock observations and session readiness

Trusted auth responses separate raw database proof/session time from the
issuer's signed access-token lifetime. The client accepts clock observations
only with actual current transport response provenance. Lossless timestamp
comparison and monotonic elapsed time conservatively shorten budgets; browser
wall time and configured token TTL cannot establish a fresh proof. Clock fields
are observational and excluded from persisted user identity; real security,
permission, version, scope and denial facts remain part of identity checks.

Reloaded stored sessions require the existing real refresh before publishing
ready authentication. A current-user read alone cannot establish all current
session horizons. Clinical dispatch checks current readiness before allocating
a write ledger and again immediately before fetch after asynchronous work.
Expired evidence cannot revive an old read or acknowledge an uncertain write
merely because later evidence has the same visible scope.
The UI's module discovery additionally requires the existing explicit
`system.deployment_capabilities.view` permission. Successful sign-in alone does
not grant it; a capability denial must remain a denial.

The capability-read permission alone does not imply an admin role. Optional
global reads require their actual permission and feature, and clear unavailable
data without representing it as zero. A new clock sample cannot revive a
previous result after denial. The denial-only GET witness uses the actual thrown
error and a separate exact committed owner value held in private memory; it does
not change the flat refresh principal, query keys or successful-response/write
admission. A committed owner change invalidates older witnesses permanently,
even when the owner later returns to its prior visible values.

## Draft continuity after verified proof

The actual token/transport scope stays strict. A separate volatile continuity
registry stores only opaque hashes and a coarse address-free network decision.
An ordinary confirmation can establish this command's continuity only when its
actual returned witness binds its own admission, published raw proof, session
and assurance revision to the exact current response and original dispatch.
The existing signed password time remains nondecreasing and follows the
canonical min(floor(stored proof), issuer iat) rule. A well-formed independently
current result may apply without being accepted as this command's successful
confirmation. No two-second browser-wall-clock tolerance is used for admission.
Password confirmation never introduces or extends factor evidence.

Before installing a proof transition, a fixed GET reads network access with the
exact new token. Matching current readable policy evidence can seed the new
binding briefly while authoritative rechecking runs. Every budget is shortened
by its actual response lifetime. Errors, denial, unknown classification, changed
policy or changed authority do not retain the clinical workspace. A continuity
registry cannot authorize a business request or automatically replay one.

A previously ready authorized workspace can remain concealed and inert during
renewal/checking; initial unready sessions mount no clinical content. Confirmed
denial, logout or visible authority/security/proof changes retain the clearing
policy. A DOM-only key bridge across an exact verified refresh compares the
observable signed proof and authority. The refresh DTO cannot establish equality
of same-second high-resolution predecessor password proofs when session-local
assurance resets; no such stronger claim is made. Canonical issuer clamping can
conservatively clear an instance even when its underlying proof is unchanged.
Strict transport, query, write, acknowledgment and submit scopes still rotate.

Note, fluid, admission follow-up and prescribing scopes use selective continuity.
Already-dispatched old-scope work is aborted and remains its original uncertain
command; late callbacks cannot publish. Known receipts remain known. Exact
UUID/body retry or validated immutable receipt lookup stays explicit. Controllers
keyed directly to strict transport may still remount or clear their drafts;
instance retention does not promise survival of every downstream workflow.

Synthetic fetch/Host and real provider controls cover skewed browser clocks,
response provenance, pending grants, current budgets, cancel/late completion,
same-session confirmation, selective draft continuity, policy/assurance expiry
and old response/refresh fences. Modeled compatibility fixtures are separately
classified and do not manufacture actual response provenance. These tests do
not verify JWT signatures, hardware ceremonies, rendered usability or production
RP/origin readiness; native/backend and real-browser evidence is recorded separately.

The initial app loads only lightweight factor-signal and restricted-login gates.
The factor form loads after a pending grant; protected-action verification loads
after an exact current-scope signal. Assurance API, browser ceremony and proof
staging code load on explicit use. Local download failures offer an explicit
retry/cancel without opening an account or sending the existing clinical draft
through the app error boundary. Every operation rechecks its lifetime after
deferred loading and before dispatch; loading never bypasses scope or network
proof.
