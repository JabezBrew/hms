# React Doctor Triage

## Ground Rules

- React Doctor is a diagnostic source, not an authority. Verify runtime behavior and code ownership before editing.
- Never chase cosmetic warnings while errors, accessibility blockers, or runtime correctness findings remain.
- Do not suppress a rule unless the finding is proven false-positive and the suppression is narrow and documented.
- Run `npm run doctor:summary -- <diagnostics-dir-or-json>` to summarize a saved scan.

## Priority Order

1. Errors: security, undefined JSX, invalid ARIA, missing cleanup, nested component definitions, mutable dependencies.
2. Correctness warnings: unstable keys, derived state effects, event-handler effects, query invalidation, stale closures.
3. Accessibility warnings: labels, keyboard handling, semantic controls, `autoFocus`.
4. Performance warnings: heavy imports, repeated lookups, unstable props/context, render hot paths.
5. Architecture warnings: giant components, only-export-components, barrel imports.
6. Mechanical warnings: Tailwind `size-*` and spacing shorthand.

## Known Noisy Areas

- Mutable dependency warnings around stable library objects must be verified before changing dependency arrays.
- Dead-code detection can fail non-fatally in this environment.
- Remote score calculation can be unavailable while local diagnostics are still useful.
- Large warning families can be dominated by mechanical Tailwind suggestions; do not let those drive the remediation plan.

## Evidence Format

For every batch, record:

- Rule family and count before/after.
- Files touched.
- Runtime behavior inspected.
- Why the change is safe for PHI, accessibility, correctness, and performance.
- Commands run and whether they passed.

For false positives, record:

- Rule.
- File and line.
- Why the scanner interpretation is wrong.
- Why leaving code unchanged is safer than changing it for score.
