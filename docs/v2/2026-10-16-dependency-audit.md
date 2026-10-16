# Dependency advisory rescan

Status: verified against the current public advisory responses on 2026-10-16.
Owner: Security Engineering

The frontend npm audit reports zero known advisories across the resolved lock.
Its metadata counts 743 dependencies. The lock SHA-256 is
`c553b16e19aa0489ef554b843573aa4b8bd8f6262bf43bb969c8b5cb76e503e3`.

The Rust OSV batch query includes all 337 public crates.io versions in Cargo.lock;
workspace/private package names and source are not sent. The response contained
no continuation tokens. One match remains: rsa0.9.10,
[RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html).
The current primary advisory reports no patched versions. Separate locked offline
Cargo dependency trees for both aarch64-unknown-linux-gnu and
x86_64-unknown-linux-gnu report no dependency on rsa. The lock includes optional
packages that are not selected by these active Linux builds; this is not an
assertion that the locked crate is patched. Cargo.lock SHA-256 is
`ec33c2afb97fcf6b07a151367afeb2c480a00b5cc93b7e5a22c2418aca3bcf15`.

The scan uses OSV's documented querybatch package/version contract and preserves
input/result ordering. These checks measure reported package advisories, not
application authorization, clinical correctness, capacity, or absence of unknown
vulnerabilities. Dedicated source, transaction, HTTP and UI regression checks are
recorded in each checkpoint's verification document.

Evidence: `/tmp/hms-phase7-npm-audit.json`,
`/tmp/hms-phase7-rust-osv-{query,result,findings}.json`,
`/tmp/hms-phase7-rsa-linux-{arm64,amd64}.log`.
