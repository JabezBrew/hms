# Session-bound WebAuthn ceremonies

The existing Rust enrollment and assertion-test endpoints now bind every new
challenge to the exact initiating refresh-session identity, user, facility,
profile, session version and permission version. Their request and success
response shapes remain unchanged. A token refresh rotates the session identity;
an unfinished ceremony from the previous session must be restarted.

This is ceremony hardening, not enforced MFA login. Password login still issues
the existing session. Enrollment remains enrollment, and assertion verification
still returns only `verified: true`. It does not advance password `auth_time`,
establish session MFA assurance, or change privileged-action policy. Recovery
login, stronger credential-management proof and TOTP remain separate work.

## Persistence and authority

Migration `202610160021_webauthn_session_binding.sql` retires existing unbound
challenges by marking them consumed. It retains their state and any existing
consumption timestamp. It does not delete users, sessions or credentials, assign
permissions, or fabricate initiating sessions. New active challenges require a
complete session-binding tuple.

Options and verification carry the server-resolved `NetworkContext` authority
deadline. The repository locks facility, user and exact refresh session in that
order, validates active profile/account and both versions, and caps the deadline
by actual session idle/absolute/refresh expiry. These are self-service credential
ceremonies; no new clinical, Admin, Nursing or offsite privilege is inferred.

Verification then locks the matching challenge and, for assertions, the current
active credentials in deterministic ID order. The database checks actual
`clock_timestamp()` after those waits and immediately before commit. It does not
use transaction-stable `now()` as evidence that a waiting challenge remains live.
Account/profile/version/session changes serialize against the held proof locks;
natural expiry is independently checked after waits and after audit.

Wrong actor, session, purpose or version cannot consume the rightful challenge.
A matching cryptographically invalid response consumes its own challenge and
records a minimal failure audit in the same transaction, retaining the existing
one-attempt behavior. Successful credential persistence, challenge consumption
and success audit commit atomically. Audit or final authority/expiry failure
rolls back all three. Audit metadata contains no client data, key, assertion,
challenge state, name, email or credential identifier.

No browser ceremony or external I/O occurs inside the transaction. Only local
cryptographic verification and database work happen while locks are held.

## Remaining lifecycle bounds

Active credentials are still fetched in full, and assertion verification now
locks that full set in deterministic order. The existing API has no maximum
enrolled-credential count, no bound on outstanding challenge creation per
account, and no expired-challenge cleanup worker. This slice makes no claim of
constant rows scanned or bounded credential/challenge storage. Silently limiting
the credential list would exclude legitimate keys and is not a safe fix. The
next authentication-management slice must implement explicit credential limits,
bounded pending ceremonies and indexed cleanup together with genuine login and
step-up management. Those lifecycle changes are deliberately outside this
two-defect repair.

## Regression evidence

`hms-api/tests/support/webauthn_signing.rs` is a test-only software authenticator
using the existing `aws-lc-rs` development dependency. Each fixture generates an
ephemeral ES256/P-256 private key in memory, emits a COSE public key and genuine
WebAuthn authenticator/client data, and signs assertion bytes. Keys are never
serialized or committed. Standard `none` registration attestation makes no
manufacturer-attestation claim; the subsequent assertion proves possession of
the registered private key.

`webauthn_crypto_contract` exercises the actual options and verification HTTP
routes against isolated Docker PostgreSQL databases. It covers real enrollment,
assertions, persisted counters, wrong origin/RP/challenge/signature/credential,
presence and verification flags, expired challenges, wrong actor/purpose/session,
same-session completion, simultaneous one-time consumption, live session
revocation after a database wait, final-audit expiry, atomic audit rollback and
the populated legacy migration. These checks establish the stated ceremony
contract; they do not establish MFA login enforcement or physical-device browser
acceptance.

The deployed RP ID and exact HTTPS origin still require correct
`HMS_WEBAUTHN_RP_ID` and `HMS_WEBAUTHN_RP_ORIGIN` configuration. The local fixture
explicitly uses `localhost` and `http://localhost:8080`; no production credential
or native account is used by these tests.
