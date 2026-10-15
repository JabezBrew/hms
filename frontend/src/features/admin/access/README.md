# Managed access grants

Active Rust V2 route: `/admin/access-grants`. The dedicated
`admin.authority.manage` capability and Admin feature are required by the UI and
server. This is a cursor-paginated review and revocation workflow for permission
assignments, delegations and authority appointments; it does not introduce a new
organization or role editor.

`GET /api/v2/admin/access-grants` returns facility-scoped grant summaries.
`POST /api/v2/admin/access-grants/{kind}/{id}/revoke` retains the original grant,
records the server actor/time, increments the affected user's permission version
and writes an atomic audit event. Revocation is idempotent. The server checks
fresh reauthentication and existing account security enrollment requirements.
The dialog signs in the same user/facility/profile with their current password;
the password stays in transient component/call state and is cleared after each
attempt. It is never a Query or Mutation cache payload.

New managed permission assignments and delegations are no longer copied into
permanent `user_permissions`. The authorization projection derives currently
active facility-wide permissions from their live time/scope/status records.
Organization-unit permissions and appointments retain their scoped authority
semantics. Other valid sources and direct permissions survive revocation.

Historical copies have no reliable provenance. Migration 007 marks direct rows
that overlap historical grants `legacy_unresolved`, retaining their previous
access until an administrator explicitly reconciles the staff member/permission.
The server returns 409 `access_grant_reconciliation_required` until the caller
chooses `retain_independent` or `remove_historical_copy`. That decision, grant
status, permission version and audit persist together. Removing a historical
copy preserves other active managed grants. Retaining it explicitly preserves a
direct permission; the confirmation never claims that all access was removed.
Historical copied access can outlive its old grant until this review is complete.

Authorization caches recheck durable user permission/session versions before a
cache hit and expire at the next managed authority start/end boundary. Tests use
two independently constructed API states sharing PostgreSQL to verify immediate
grant-revocation denial. This does not claim cross-instance session-specific
logout propagation or continuous revocation of data already displayed in another
browser tab; those are separate realtime/session workflows.

Unknown network/5xx/malformed-success and generic409
`access_grant_revoke_failed` outcomes remain explicitly unconfirmed. There is no
automatic mutation retry. An explicit retry keeps the same reconciliation choice;
a successful response remains visible if the list refresh fails.
