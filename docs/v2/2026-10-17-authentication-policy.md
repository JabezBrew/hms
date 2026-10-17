# Password and factor authentication policy

Status: implementation in progress; phase-twelve acceptance is not complete.
Active source: Rust V2. This document does not claim full Python feature parity.

## Sign-in and first enrollment

An account with an active passkey must verify an existing factor after its
password. The password response contains a short-lived opaque login grant and
supported factor methods; it contains no ordinary access token, authenticated
user, refresh cookie or clinical capabilities.

The ten existing privileged permission families require passkey setup for an
unenrolled account. An unenrolled account outside that policy retains explicit
password-only compatibility. Rust does not introduce an all-user MFA setting.
The separate setup-start command makes voluntary first enrollment reachable for
those accounts without converting its restricted grant into a normal session.

First enrollment requires the account password and an expiring, named-user,
one-time operator bootstrap token. Operator identity checks and secure token
delivery are an external trust requirement; the application does not prove a
person's real-world identity. Registration alone returns to factor-required
state. A separate actual signed assertion is required before session assurance.
TOTP is outside this implementation.

## Durable proof and privileged actions

Password verification and factor verification are separate durable facts.
Fresh passkey assurance belongs to the exact facility, user, session, profile,
session version, permission version and credential epoch. Its maximum lifetime
is fifteen minutes. Assertions require authenticator user verification.

Passkey-only step-up does not advance password verification. An expired password
proof requires explicit password confirmation followed by an actual passkey
assertion; confirmation is committed only with that assertion. Confirmation
keeps the same session and refresh cookie. It does not retry a clinical action.

An unused recovery code plus the password can create a recovery-authenticated
session. Recovery assurance does not satisfy privileged passkey proof, enroll
replacement keys, regenerate recovery codes or bypass operator first setup.
Consumption and session creation are atomic.

The privileged permission families are authority management, feature
entitlements, staff administration, system operations, controlled substances,
laboratory verification, billing management, NHIS management, consent management
and break-glass invocation. Separate existing lab, consent and override gates
remain explicit. Ordinary operational admission closure keeps its existing
rights; it is not promoted into a privileged clinical clearance command.

Protected mutations require proof inside their persistence transaction, current
family permission and feature checks, and an actual database-clock check after
source/audit waits immediately before commit. Preflight checks alone are
insufficient. Existing clinical visibility and patient/ward scope still apply.
An authenticated user required to change their password is restricted to the
exact own-password/session lifecycle until that change succeeds.

## Administration transaction ordering

Privileged administration acquires facility, deterministically sorted actor and
target users, exact session and factor evidence, then mutable source records.
Feature publication acquires the exclusive facility lock first rather than
upgrading a shared lock after taking a user lock. Reciprocal administrative
commands must not acquire users in opposite orders.

Active services call mandatory authorized repository variants. Existing trusted
provisioning/test repository interfaces share the same core behavior but are
not used by the HTTP mutation path. External account-setup delivery stays outside
the database transaction. Password reset finalization verifies proof again after
delivery; a prepared reset token remains unusable until finalization commits.

## Credential lifecycle and client behavior

The active-key cap is ten. Metadata lists are bounded. Pending ceremonies and
issuance/verification budgets are durable across application instances. Invalid
or over-cap stored keys require explicit operator review; a key must not be
silently omitted to make password-only fallback possible. Normal management
requires fresh existing-passkey proof and preserves the last-key guard.

Key withdrawal invalidates key-derived assurance in other sessions and warm
application caches. Refresh transfers only live, compatible exact-session proof,
preserving its original verification and expiry times. Migration starts existing
sessions without factor proof; it does not invent assurance or mass-enroll keys.
Bounded cleanup removes expired ephemeral grants/challenges, preserving credential
history, operator decisions and audit evidence.

The frontend keeps restricted grants and raw factor secrets in memory. A new
account sign-in first ends the previous server session. Same-session verification
uses an explicit prompt and cannot override network restrictions or patient
access. Actual request token/authority fences remain strict during UI draft
continuity. An interrupted clinical write retains its reviewed command and must
be reconciled before another write; verification cannot confirm that write.

## Acceptance still required

Full workspace tests, generated contract/client checks, production build and
budgets, cryptographic lifecycle and permission-matrix regressions, native
synthetic workflow checks and independent security/performance review must pass
before phase-twelve release. Physical authenticator/browser acceptance and live
deployment require their own evidence. No native or remote human account is
bootstrapped, enrolled or retired by implementing this source change.
