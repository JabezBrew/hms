# Verified session factor assurance

This checkpoint implements real WebAuthn verification at login and privileged
step-up. It does not establish real-world identity, hardware attestation,
signature authority, or TOTP support. Existing enrollment and assertion-test
endpoints remain distinct from assurance. A successful assertion-test cannot
mint or refresh factor proof.

## Sign-in and setup

Every account with an active passkey must complete a genuine assertion after
password verification. The password response is a restricted, expiring grant
with no access token, refresh cookie, or AuthUser. Privileged accounts without
keys receive restricted setup instead. Nonprivileged unenrolled accounts retain
explicit password-only compatibility; `/auth/setup/start` begins restricted
first setup when requested. No all-user enforcement flag was invented.

A local operator must explicitly name the user and acknowledge an identity
check before issuing a one-time bootstrap token. Bootstrap registration creates
a key but no ordinary session. A separate actual assertion is required next.
The operator acknowledgment is an identity-check boundary, not proof that an
external identity check occurred. Existing native or remote accounts are not
modified automatically by this source implementation or migration.

The tagged `authenticated` response preserves the established token shape.
`factor_required` and `setup_required` responses contain only the restricted
grant, deadline, supported methods and reason. All grant/challenge context is
durable and bound to the exact actor, purpose, versions, profile and initiating
session where applicable. Wrong-session/purpose attempts do not burn rightful
challenges. Matching invalid cryptography consumes its own challenge and audit
atomically. Successful login consumes its grant atomically with the new session.

Required password changes happen after the required factor. Such tokens remain
server restricted to their own password, logout, refresh, status and session
retirement lifecycle until the password is changed. Password change/reset
revocation remains in force; clinical workflows cannot use this restricted token.

## Distinct proof and management

Durable password verification and passkey UV assurance have independent
15-minute privileged freshness windows. Password proof uses the database
admission clock captured before Argon work; lock waits never advance it. A
passkey-only step-up preserves password time. Explicit password confirmation is
staged and applies only after a genuine assertion, returning a new JWT for the
same exact session without extending the absolute session lifetime.

Refresh transfers only live compatible proof and preserves its original method,
verification time and deadline. Recovery is an atomic one-use password-plus-code
login with `method=recovery`; it cannot authorize key-required privileges or
factor replacement. It remains distinct after refresh.

Existing-factor registration, rename, disable and recovery-code replacement
require fresh actual passkey proof. Recovery replacement additionally verifies
the current password. The last active key cannot be disabled through normal
management. Counting active or structurally valid keys does not prove physical
usability. All active records are validated without filtering; malformed or
over-cap records require explicit operator review. Retirement preserves the
original record and immutable reviewed operator evidence.

The credential epoch and exact-session assurance version participate in each
node's durable auth version check. Key changes invalidate warmed factor proof
across instances. Factor expiry limits cache freshness, not ordinary session
authority. Privileged repositories retain separate session/authority, password
and factor cutoffs through the final database-clock check and audit commit.

## Bounds, operations and deployment

Each account supports at most ten active passkeys, three pending challenges of
each purpose, and bounded per-purpose issuance and verification attempts.
Credential reads fetch at most eleven records so an over-cap account fails with
management guidance instead of silently losing a valid key. Pending admission
uses an indexed stable statement-time expiry range and reads at most three live
rows, even when expired history awaits cleanup. The metadata catalog retains
disabled keys and seeks through their indexed creation-time/ID history without
returning credential identifiers or stored key material. The worker removes
only bounded batches of ephemeral records expired for more than a day. Keys,
sessions, audit and operator-review evidence are not cleanup targets.

`hms-migrator auth-readiness --facility-code ...` emits aggregate counts only:
privileged unenrolled accounts, structurally invalid active keys, over-cap
accounts and RP/origin configuration facts. Structural validity is explicitly
not usability. `bootstrap-factor` requires a named user, identity-check
acknowledgment and a new private token file; raw tokens are not printed.
`retire-factor` requires a named user and key plus a bounded reason on stdin.
These are deliberate operator actions, not startup repair or a password bypass.

Outside development/tests, an explicit valid RP ID and HTTPS origin are required.
The Compose kit derives these from the reviewed client domain unless explicitly
configured. Existing keys cannot be moved between RP origins by changing an
environment variable. Before rollout, run readiness privately and arrange real
human credentials or dedicated synthetic acceptance identities. An ephemeral
test signer must never be enrolled onto a human's ordinary account.

The privileged route matrix covers all ten permission families plus separate
lab, consent, break-glass, HMS Ops and network policy gates. External Cloudflare
Ops authentication retains its separate provider boundary. Evidence comes from
real runtime software authenticator signatures, isolated database HTTP contracts,
source-lock/audit waits, revocation, key disable and recovery races. Software
fixtures prove the verifier contract; they are not hardware/security-key UX
certification or approval to enforce a real account rollout.
