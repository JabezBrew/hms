# Fluid workspace context and clinical visibility

Scope: the Rust Patient Chronicle fluid panel. Patient-specific clinical
documentation remains in Chronicle; the existing scalar vital/fluid trend
surfaces have separate visibility contracts.

The workspace uses the explicitly selected admission. Choosing all-history
removes the admission filter and new-entry action, including when another
admission is currently active. Selected patient and admission identifiers are
sent together for a new observation. Rows, totals and monitoring use the same
selected admission; changing selection discards copied form and dialog state.

`GET /nursing/fluid-observations/context` supplies only the reviewed patient and
admission identifiers, actual admission status and server new-entry eligibility.
The UI verifies the returned identity and status, waits for a fresh read and
never infers admission activity from an encounter or an identifier. Historical
closed admissions remain reviewable and may support separately authorized,
audited corrections or voids. They cannot receive a new observation. A retained
uncertain exact command can be replayed under current access; closing an
admission does not turn an unknown original result into a new recording.

Rich observations, metadata, correction reasons and history require current
FullClinical, Nursing feature and workflow permission. Summary access alone
does not mount this panel or send its requests. Cached narratives are withheld
until a fresh scoped read completes. A current denial from context, rows,
summary, assessment, source or history hides the whole rich workspace and
unmounts copied controllers. The user must refresh current access before
continuing. Existing scalar Summary totals/trends remain separate.

The existing scoped publication helper fences success, failure and caller
callbacks by component lifetime, current transport and authorization proof.
The opaque central uncertainty store remains authoritative after a dispatched
write loses its controller. No clinical body, patient label or raw URL is added
to persistent storage. No automatic write retry is introduced.

Verification uses actual generated-client/fetch and Chronicle Host regressions
for historical A versus current B, admission selection resets, all-history,
Summary denial, fresh protected-read denial, uncertain exact retries, and late
responses after context changes. Browser and release acceptance belong to the
parent checkpoint; this document does not claim clinical acceptance.
