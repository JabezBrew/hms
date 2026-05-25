# AI-100 Governance Decision Record

Date: February 22, 2026  
Status: Approved baseline for implementation planning  
Owner: Product + Security + Clinical Engineering + Platform

## Purpose

Lock the open governance decisions from the AI integration specification so Sprint 1 and Sprint 2 delivery can proceed without policy ambiguity.

## Final Decisions

1. Hosting mode
- Launch with `AI_HOSTING_MODE=hybrid`.
- Use managed enterprise inference for high-quality text generation.
- Use self-hosted retrieval components where practical to control cost/latency.

2. Provider and model approvals
- `reasoner_large` and complex `writer_medium`: Azure OpenAI (primary), Bedrock-hosted Anthropic class (secondary).
- `intent_small` and `validator_small`: low-latency compact models in the same approved provider stack.
- `asr_medical`: managed medical ASR primary, Whisper-class fallback.
- `embedding_model`/`reranker_model`: self-hosted (`bge`-class) for initial launch.

3. Retention policy
- `AI_AUDIO_RETENTION_DAYS=3`.
- `AI_TRANSCRIPT_RETENTION_DAYS=30`.
- After clinician sign-off, retain only note-linked evidence excerpts and purge full transcript payloads.

4. Pilot rollout cohort
- Outpatient-first pilot in a single facility.
- Initial enabled roles: doctor and nurse cohorts only.

5. Sprint 1 lab interpretation scope
- Use lab-native context (result history/trends + bounded safe context) for MVP.
- Defer broad chronicle retrieval coupling to later scope unless safety review requires it.

6. Sensitive action policy for Omni
- Always require confirmation for write/update/delete/sign actions.
- Always require confirmation for orders/medications workflows.
- Always require confirmation for break-glass, PHI export/share/print, billing submissions, and role/admin changes.

7. Response contract standardization
- All AI endpoints must return a common JSON envelope with:
  - `schema_version`
  - `feature`
  - `confidence`
  - `citations`
  - `result`
  - `requires_human_review`

8. Confidence thresholds
- `<0.70`: mark as `Needs Review` with prominent warning.
- `0.70-0.84`: advisory output with caution.
- `>=0.85`: normal advisory output.
- Omni parse confidence `<0.65`: fallback to legacy omni behavior.

9. Note lint enforcement
- Draft save is never blocked by lint.
- Finalize/sign is blocked on `critical` issues.
- `major` requires explicit acknowledge/override.
- `minor` remains informational.

10. Ambient scribe sprint scope
- Sprint 2 scope remains spike + consent/policy UX only.
- Non-production scaffolding is allowed; production-grade endpoint rollout is out of scope for Sprint 2.

11. Retrieval backend strategy
- Start with `pgvector`.
- Keep reranker pluggable and enable first on Chronicle retrieval only if quality evaluation shows need.

12. Release gate thresholds
- PHI leakage in logs: `0` tolerated.
- High-severity auth/access-control bypass findings: `0` tolerated.
- Prompt-injection block rate: `>=99%`.
- Omni sensitive-intent classification accuracy: `>=99%`.
- Core AI endpoint error rate in staging: `<1%`.
- p95 latency gates must meet the feature SLOs in `AI_INTEGRATION_SPEC.md`.

## Implementation Defaults

### Configuration defaults
- `AI_HOSTING_MODE=hybrid`
- `AI_AUDIO_RETENTION_DAYS=3`
- `AI_TRANSCRIPT_RETENTION_DAYS=30`
- `AI_VECTOR_BACKEND=pgvector`

### Runtime policy defaults
- `requires_human_review=true` on generated artifacts by default.
- Omni confirm-required actions are policy-driven server-side (frontend mirrors for UX only).
- Confidence thresholds are enforced server-side and reflected in UI labels.

## Notes for Backlog Execution

- Treat this record as the source of truth for ticket acceptance criteria where governance policy affects implementation.
- If a provider/compliance requirement changes, update this file and revalidate dependent tickets before coding.
