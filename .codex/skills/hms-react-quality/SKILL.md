---
name: hms-react-quality
description: Guide HMS frontend React implementation, refactoring, code review, and React Doctor remediation. Use when Codex touches /Users/jebre/Desktop/hms/frontend React code, fixes React Doctor findings, splits giant components, changes hooks/data fetching, reviews accessibility/performance, or prepares frontend work for commit.
---

# HMS React Quality

Use this skill with the local `react-doctor` and `vercel-react-best-practices` skills. This skill adds HMS-specific constraints, verification, and reporting.

## Load References

- Read `references/implementation-contract.md` for any React implementation or review.
- Read `references/react-doctor-triage.md` when working from React Doctor diagnostics.
- Read `references/architecture-patterns.md` when splitting components, hooks, pages, or feature modules.

## Required Orientation

1. Read `/Users/jebre/Desktop/hms/AGENTS.md`, `/Users/jebre/Desktop/hms/claude.md`, and `/Users/jebre/Desktop/hms/frontend/CHRONICLE_DESIGN_SYSTEM.md`.
2. Inspect the actual route, component, hook, and API path before editing.
3. Treat scanner findings as hypotheses. Fix verified issues, not raw counts.
4. Keep changes batched by rule family or ownership area.

## Verification Commands

From `/Users/jebre/Desktop/hms/frontend`:

```bash
npm run lint
npm run build
npm run quality:react:diff
```

Use full scan only for remediation campaigns or architecture audits:

```bash
npm run quality:react
npm run doctor:summary
```

If React Doctor remote scoring is offline, use the local diagnostics and native gates. Do not treat score unavailability as a pass or a failure by itself.

## Implementation Contract

- Preserve PHI boundaries. Clinical patient data belongs inside PatientChroniclePage surfaces.
- Prefer feature modules under `src/features/<domain>/` with `api/`, `hooks/`, `components/`, `pages/`, `routes.js`, and `index.js`.
- Keep `src/pages/*` route wrappers thin.
- Use `PageShell`, `PageHeader`, and `PageState` for page structure.
- Use centralized React Query keys. Avoid ad-hoc array literals for shared queries.
- Thread `signal` through list-fetching helpers and preserve `AbortError`.
- Do not fetch full paginated datasets just to filter client-side.
- Do not add unsafe HTML, eval, PHI logs, token leakage, or broad client-side data exposure.
- Prefer accessibility and correctness over scanner score.

## React Doctor Policy

Fix errors before warnings. Prioritize:

1. Security and correctness: `no-eval`, undefined JSX, unsafe render paths, mutation in render.
2. Accessibility blockers: invalid roles, missing labels, keyboard-inaccessible click targets.
3. Effect correctness: missing cleanup, derived state in effects, nested component definitions.
4. Runtime correctness: unstable keys, stale closures, query invalidation mistakes.
5. Performance in hot flows: repeated render-time scans, heavy imports, unstable props/context.
6. Architecture: giant components and only-export-components when extraction improves locality.
7. Mechanical style: Tailwind shorthand and cosmetic warnings after high-signal work.

Do not add broad suppressions. If a diagnostic is false-positive/tool-noise, document the rule, file, why it is false, and why no code change is safer.

## Final Report

Report:

- Files touched and ownership area.
- React Doctor rules addressed or intentionally left.
- `npm run lint`, `npm run build`, and React quality gate results.
- Any remaining diagnostics with reason.
- Any browser verification performed for visual or accessibility-sensitive changes.
