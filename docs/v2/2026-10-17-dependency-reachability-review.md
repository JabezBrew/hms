# Dependency advisory reachability review

The locked optional `rsa`0.9.10 dependency remains affected by
[RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html). The primary
advisory was checked on2026-10-17 and still lists no patched version. An upgrade
is not claimed as a repair, and no audit suppression or exception was added.

The workspace already disables SQLx defaults and enables PostgreSQL explicitly.
Its JWT dependency selects `aws_lc_rs`. Locked optional package presence is
distinct from the selected production dependency graph.

`cargo tree --workspace --locked --offline --edges normal,build` was evaluated
separately for these configured target shapes:

| Target | Selected packages | PostgreSQL selected | MySQL/RustCrypto RSA selected |
| --- | --- | --- | --- |
| aarch64-apple-darwin |254| yes | neither |
| x86_64-unknown-linux-gnu |254| yes | neither |
| aarch64-unknown-linux-gnu |254| yes | neither |

All three commands passed again against the recovered frozen checkpoint18 source.
Counts deduplicate package name/version pairs and exclude repeated tree markers. All workspace Cargo manifest/lock fingerprints remained unchanged. Exact graph/log
hashes are recorded in the local dependency-reachability receipt. This supports
the narrow conclusion that the affected optional crate is absent from those
selected normal/build graphs. It does not certify every dependency or every
possible feature combination, and Linux metadata resolution is not a Linux
cross-compilation or cryptographic runtime test.

An earlier all-target offline attempt could not resolve an uncached Android
support package. That attempt is not accepted as an all-target result. No
dependency or lockfile change was made to manufacture a clean audit. Recheck the
advisory and selected graph when changing SQLx/JWT features, targets or versions.
The residual lockfile advisory remains separate from this reachability evidence.


The frontend production dependency audit (`npm audit --omit=dev --json`) also
completed on2026-10-17 with exit0 and zero reported advisories at every severity.
Both package manifests retained their original SHA256 fingerprints. No fix,
lockfile rewrite or audit suppression was added. The JSON report hash is
`d02516f883b7cad8d084e51c31204c692f21ec205b1d90b463895603a6c2f079`.
This is a production-dependency advisory check, not a frontend security or
accessibility certification. Development dependencies are outside that command.

A read-only [OSV batch lookup](https://google.github.io/osv.dev/post-v1-querybatch/)
checked all337 registry package/version pairs from the same frozen Cargo lock.
Pagination completed; the sole reported package was `rsa`0.9.10 with
`RUSTSEC-2023-0071`. The lock fingerprint stayed unchanged. This is a current
version-based advisory lookup, not proof of every dependency implementation,
container/OS vulnerability status or runtime exploitability. The selected-graph
checks above separately establish the reviewed production build reachability.

A separate OSV version lookup checked all716 unique public npm package/version
pairs in the same lock, including development dependencies. Six bundled entries
without resolved URLs were verified against their exact public registry metadata
before inclusion. Pagination completed with zero advisory matches and zero
skipped package entries; a known affected public package used solely as a
protocol control returned advisories. Both lock and manifests remain unchanged.
The ordinary full `npm audit` endpoint did not return usable advisory metadata
on this attempt, so it is not counted as a clean result. The earlier successful
production-only npm audit and this independent OSV lookup are distinct evidence.
Neither proves implementation, browser, container or whole-product security.
