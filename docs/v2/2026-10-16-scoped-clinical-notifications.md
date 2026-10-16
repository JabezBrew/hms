# Scoped asynchronous clinical notifications

Status: implemented narrow phase8 source; parent owns release acceptance.

The installed Sonner Toaster starts with an empty display list and subscribes to
new events. An already displayed toast does not replay when the authoritative
network boundary unmounts and remounts it. Clearing library history is therefore
not the fix for the confirmed issue.

A real Rust problem-resolution callback could finish after actor A's workspace
unmounted and actor B mounted, then publish A's clinical problem label into B's
Toaster. This uses a new event after completion, rather than replaying store
history. The regression uses actual ProblemListSidebar, generated API transport,
authoritative NetworkAccessBoundary and actual Toaster with synthetic text.

The shared useScopedNotifications hook returns capture(). An async handler calls
capture before awaiting and uses that same publisher for success and failure.
Publication requires the originating committed component lease, shared central
authorization identity, live transport and authority proof to remain current.
Actor, facility, profile, session/permission versions, capabilities, features,
patient visibility, security facts, network proof/policy and optional opaque
workflow context changes revoke the lease. Fresh-reauth expiry is checked at
publication even if the cached decision has not refetched. Equivalent normal
rerenders do not revoke a valid publisher. Unmount or A→B→A never revives an old
publisher.

The existing network authorization identity implementation is moved to a shared
module with compatible network export names. There is no second permission
model. The helper stores only ephemeral opaque scope/proof values and deadline;
no messages, patient identifiers, bodies, tokens or clinical text enter storage
or new query keys. It does not rewrite Sonner, change API outcomes, retry/abort
writes or clear the opaque uncertain-write barrier.

Coverage is deliberately narrow: the confirmed ProblemListSidebar callback uses
the helper. Library toast.promise has no current HMS caller and does not gain a
global scoping guarantee. Other async notification callsites require separate
source review and adoption. Tests cover same-scope success/error, cross-account
success/error/network loss, deadline, normal rerenders, permission/access/transport
changes, context changes, unmount and retained uncertainty/privacy.
