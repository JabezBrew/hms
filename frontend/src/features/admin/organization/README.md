# Organization directory and governed unit changes

Rust-only feature for `/admin/organization`; `OrganizationRoute` keeps the explicit
legacy Django page separate. Browsing requires actual `admin.authority.manage`
and the Admin feature. A role alone does not enable the route, sidebar or page.
Ordinary directory reads do not require a fresh privileged-factor hint.

The server returns bounded cursor pages (25 per request). There is no client-side
whole-tree reconstruction, all-pages fetch, inferred ancestor or global search.
Parent labels come from the server projection; an unavailable/redacted parent
is never reconstructed by querying another scope.

Create supports code, name, type and an explicit parent choice. Code, type and
parent are permanent. Rename changes only the name. Retirement and reactivation
retain history, require a fresh exact detail version and a separate review, and
may refuse recorded child, position or organization permission references,
including inactive/historical references. Closing those references does not
remove history or enable legacy authority restoration in this slice.

Staff membership, leadership, coverage and department–clinic service links are
unavailable here. No successful empty relationship arrays stand in for those
features. Unit creation/activation does not assign clinical or staffing access.

Commands retain the exact reviewed body/UUID only in RAM across ordinary close.
Current authority denial or scope changes unmount local copies. Uncertain writes
keep the shared opaque barrier; exact retry preserves the original input. Only
an actual actor-bound original command receipt, validated against typed tagged
input and its canonical SHA-256 digest, can establish the saved result. Current
unit/list/history reads cannot do so. Server factor/network/current-grant checks
remain authoritative; freshness hints are not authorization.

After reload, a deferred singleton accessor can locate only the current scoped
inactive original request UUID. It cannot reconstruct a body or enable retry.
An actual privileged original-receipt read followed by a separate recovery-notice
acknowledgment is required. Missing, malformed or denied receipts keep the barrier.

Recovery family selection is deferred at the first actual write/recovery read.
The exact-family router may add one initial dynamic-import hop. Loader failure
blocks dispatch, and existing synchronous dispatch/denial/acknowledgment guards
remain in the eager recovery boundary. No route grants mutation authority.
