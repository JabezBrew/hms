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

## Draft continuity after verified proof

The actual token/transport scope stays strict. The shared workflow continuity
registry is separate and volatile: it contains only opaque hashes and a coarse
address-free network decision. It is installed only after the returned token
matches the original JWT session, actor, facility, profile, permissions,
features, visibility and account security facts. The ordinary response must advance the actual assurance revision, preserve factor
version and all security facts, and carry a coherent same-session JWT with
nondecreasing password time admitted for this exact confirmation attempt. An
ephemeral timestamp captured directly before generated dispatch permits only the
explicit two-second client/signer tolerance; it does not compare admission with
response time and is never a request field or persisted receipt. Password proof
never introduces or extends factor evidence.
Exact unchanged evidence can preserve workflow continuity. A server-cleared
naturally expired factor permits applying an otherwise valid same-session token
without retaining the old workflow; JWT whole-second rounding is respected.
Passkey proof retains its existing fresh-factor predicate.

Before installing that token, a fixed GET reads network access using the exact
new token. A matching known/readable policy decision can seed its exact new query
binding for at most five seconds while the normal authoritative recheck runs.
Errors, denial, unknown classification, changed policy or changed authority do
not retain the old clinical workspace. Dispatch still requires the exact actual
token guard; workflow continuity cannot authorize a request in the intervening
frame. The registry expires no later than the new access/session deadline or
fifteen minutes. It never stores patient identifiers, drafts, passwords or JWTs.

Note, fluid, admission follow-up and prescribing controller scopes use this
selective continuity. Already-dispatched pending work is aborted on a strict
credential transition and retained as its original unconfirmed command; late
old-proof callbacks cannot publish. Known receipts remain known. Exact UUID/body
retry or validated immutable receipt lookup stays explicit. General network
denial, checking or authority changes continue to remove clinical content. Older
controllers keyed directly to raw transport may still remount; this is not a
claim that every legacy draft survives verification.

Synthetic fetch/Host tests cover restricted sign-in, old-session retirement,
cancel/expiry/late completion, same-session proof, current-factor management,
note/fluid/advisory draft continuity, fluid pending/unknown exact replay, and old
401/refresh fences. They do not verify hardware enrollment, real biometric
interaction or production RP/origin readiness. Browser clock checks are UI
expiry guards, not cryptographic proof; the server remains authoritative.

The initial app loads only lightweight factor-signal and restricted-login gates.
The factor form loads after a pending grant; protected-action verification loads
after an exact current-scope signal. Assurance API, browser ceremony and proof
staging code load on explicit use. Local download failures offer an explicit
retry/cancel without opening an account or sending the existing clinical draft
through the app error boundary. Every operation rechecks its lifetime after
deferred loading and before dispatch; loading never bypasses scope or network
proof.
