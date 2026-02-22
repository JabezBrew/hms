# AI Integration Backlog Plan (CSV Replacement)

Date: February 21, 2026  
Last Updated: February 22, 2026 (AI-100 decisions integrated)  
Source: `/Users/jebre/Desktop/hms/AI_INTEGRATION_SPEC.md` + `/Users/jebre/Desktop/hms/AI_INTEGRATION_AI100_DECISION_RECORD.md`

## Purpose

The removed CSV files were intended to convert the AI spec into an execution-ready delivery backlog for two initial sprints, with:
- clear ticket IDs and sequencing,
- owners and effort estimates,
- dependency visibility,
- acceptance criteria to measure completion.

This markdown file replaces that function in a format that is easy to track manually or in Linear.

## Scope and Sprint Goals

- Sprint 1 goal: establish AI platform foundations and ship MVP for `#8 Omni NL` and `#6 Lab Interpretation` behind feature flags.
- Sprint 2 goal: ship MVP for `#1 Chronicle Copilot` and `#3 Note Draft/Lint`, and complete Ambient Scribe spike + policy/UX readiness.

## Sprint 1 Backlog

| Ticket | Priority | Title | Owner | Points | Depends On | Outcome |
|---|---|---|---|---:|---|---|
| AI-100 | P0 | Finalize AI governance decisions | Product + Security | 3 | - | AI-100 record approved (hosting/providers/retention/pilot/safety thresholds) |
| AI-101 | P0 | Scaffold `apps/ai` and route registration | Backend | 3 | AI-100 | `/api/ai/*` endpoints available with auth/facility context |
| AI-102 | P0 | Implement model router and provider interfaces | Backend | 5 | AI-100, AI-101 | Router returns model role + timeout/retry/fallback aligned to approved provider matrix |
| AI-103 | P0 | Create AI core models and migrations | Backend | 5 | AI-101 | `AISession`, `AIMessage`, `AIArtifact`, `AIFeedback` live |
| AI-104 | P0 | Implement PHI-safe logging/redaction controls | Backend + Security | 5 | AI-100, AI-101 | No raw PHI in logs and retention policy enforcement for transcript/audio artifacts |
| AI-105 | P1 | Add AI feature flags and env wiring | Backend + Ops | 3 | AI-100, AI-101 | Runtime toggles/config include AI-100 defaults (`hybrid`, retention days, `pgvector`) |
| AI-106 | P1 | Configure Celery AI queues and retries | Backend + Ops | 3 | AI-105 | `ai_realtime`, `ai_batch`, `ai_maintenance` operational |
| AI-107 | P1 | Add baseline AI observability dashboards | Ops + Backend | 5 | AI-100, AI-102 | Dashboards include latency/errors/tokens/cost plus gate metrics (confidence, fallback, redaction) |
| AI-120 | P0 | Build Omni NL parse endpoint | Backend | 5 | AI-100, AI-102 | `POST /api/ai/omni/parse/` returns schema-valid output with confidence and fallback signaling |
| AI-121 | P0 | Build Omni execute-preview endpoint | Backend | 5 | AI-100, AI-120 | `POST /api/ai/omni/execute-preview/` enforces sensitive-action confirmation and no side effects |
| AI-122 | P0 | Add Omni intent preview and confirmation UI | Frontend | 5 | AI-100, AI-120, AI-121 | Parsed intent preview + mandatory confirm UX for sensitive actions |
| AI-123 | P1 | Omni NL regression and perf tests | QA + BE + FE | 3 | AI-100, AI-122 | Existing omni behavior preserved; low-confidence fallback and sensitive-intent targets validated |
| AI-130 | P0 | Build Lab Interpretation endpoint | Backend | 5 | AI-100, AI-102 | `POST /api/ai/labs/interpret/` with confidence + citations, scoped to lab-native context for MVP |
| AI-131 | P0 | Add Lab Interpret actions in UI | Frontend | 5 | AI-100, AI-130 | Row/order interpret actions by role with advisory/needs-review labeling |
| AI-132 | P0 | Add lab safety policy guardrails | Backend | 3 | AI-100, AI-130 | Advisory-only behavior + confidence threshold labeling enforced |
| AI-133 | P1 | Lab interpretation fixtures and tests | QA + Backend | 3 | AI-100, AI-130 | Normal/abnormal/critical coverage plus confidence-threshold behavior validation |

## Sprint 1 Exit Criteria

- Omni NL and Lab Interpretation function end-to-end behind flags.
- Access-control and PHI-log safety tests pass.
- AI queueing and observability are active in staging.

## Sprint 2 Backlog

| Ticket | Priority | Title | Owner | Points | Depends On | Outcome |
|---|---|---|---|---:|---|---|
| AI-200 | P0 | Build Chronicle retrieval context service | Backend | 5 | AI-100, AI-103 | Role/facility scoped context bundle with citations and `pgvector` default path |
| AI-201 | P0 | Build Chronicle summarize endpoint | Backend | 5 | AI-100, AI-200 | `POST /api/ai/chronicle/{patient_id}/summarize/` with standard AI response envelope |
| AI-202 | P0 | Build Chronicle ask endpoint | Backend | 5 | AI-100, AI-200 | `POST /api/ai/chronicle/{patient_id}/ask/` with confidence/citation contract |
| AI-203 | P0 | Add Chronicle Copilot panel and prompts | Frontend | 5 | AI-100, AI-201, AI-202 | Copilot panel integrated in Chronicle page with confidence state handling |
| AI-210 | P0 | Build Note Draft endpoint | Backend | 5 | AI-100, AI-103 | `POST /api/ai/notes/draft/` aligned to template revisions and common envelope |
| AI-211 | P0 | Build Note Lint endpoint | Backend | 5 | AI-100, AI-103 | `POST /api/ai/notes/lint/` includes critical/major/minor enforcement semantics |
| AI-212 | P0 | Add Generate Draft and Run Quality Check UI | Frontend | 5 | AI-100, AI-210, AI-211 | Draft/lint integrated with explicit blocking/override UX rules |
| AI-213 | P1 | Add section diff and evidence UI | Frontend | 5 | AI-100, AI-212 | AI vs clinician edits reviewable before save with evidence links |
| AI-214 | P1 | Add note workflow regression tests | QA + BE + FE | 3 | AI-100, AI-212 | Note behavior unchanged and lint-blocking policy covered |
| AI-220 | P0 | Build AI safety evaluation harness | Security + Backend | 5 | AI-100, AI-201, AI-211 | CI gates for prompt injection, sensitive-intent accuracy, and PHI-log leakage |
| AI-221 | P0 | Run load and latency tests | QA + Ops | 3 | AI-100, AI-203, AI-212, AI-220 | Chronicle/note AI SLO targets and <1% endpoint error rate verified in staging |
| AI-222 | P1 | Publish pilot runbook and fallback procedures | Ops + Security | 3 | AI-100, AI-107 | Kill-switch/outage/rollback playbook approved for outpatient-first pilot |
| AI-230 | P1 | Ambient scribe technical spike | Backend + Frontend | 5 | AI-100, AI-106 | ASR/diarization benchmark report; production endpoint rollout intentionally out of scope |
| AI-231 | P1 | Ambient scribe consent UX + policy review | Frontend + Product + Security | 3 | AI-100 | Consent flow approved for implementation |

## Sprint 2 Exit Criteria

- Chronicle Copilot and Note Draft/Lint are pilot-ready behind feature flags.
- Performance and safety gates pass staging validation.
- Ambient scribe has a validated technical recommendation and approved consent design.

## AI-100 Decision Mapping (Exact Deltas)

| Ticket | Dependency Delta | Scope/Acceptance Delta |
|---|---|---|
| AI-100 | N/A | Governance now explicitly includes confidence/lint/release-gate thresholds |
| AI-102 | `AI-101` -> `AI-100, AI-101` | Must implement approved provider/model role matrix and fallback chain |
| AI-104 | `AI-101` -> `AI-100, AI-101` | Must enforce transcript/audio retention in addition to PHI-safe logs |
| AI-105 | `AI-101` -> `AI-100, AI-101` | Must wire AI-100 defaults (`hybrid`, retention, `pgvector`) |
| AI-107 | `AI-102` -> `AI-100, AI-102` | Must include gate metrics, not only baseline operational metrics |
| AI-120 | `AI-102` -> `AI-100, AI-102` | Omni parse must surface confidence and low-confidence fallback signal |
| AI-121 | `AI-120` -> `AI-100, AI-120` | Execute-preview must enforce sensitive-action confirmation taxonomy |
| AI-122 | `AI-120, AI-121` -> `AI-100, AI-120, AI-121` | UI must enforce confirm flow for sensitive actions |
| AI-123 | `AI-122` -> `AI-100, AI-122` | Tests must validate fallback behavior and sensitive-intent criteria |
| AI-130 | `AI-102` -> `AI-100, AI-102` | Lab interpretation MVP constrained to lab-native context |
| AI-131 | `AI-130` -> `AI-100, AI-130` | UI must display advisory vs needs-review confidence states |
| AI-132 | `AI-130` -> `AI-100, AI-130` | Safety guardrails include threshold-based output labeling |
| AI-133 | `AI-130` -> `AI-100, AI-130` | Add confidence-threshold coverage in fixtures/tests |
| AI-200 | `AI-103` -> `AI-100, AI-103` | Retrieval implementation defaults to `pgvector` |
| AI-201 | `AI-200` -> `AI-100, AI-200` | Must return standard AI output envelope |
| AI-202 | `AI-200` -> `AI-100, AI-200` | Must return standard AI output envelope |
| AI-203 | `AI-201, AI-202` -> `AI-100, AI-201, AI-202` | UI must reflect confidence-driven states |
| AI-210 | `AI-103` -> `AI-100, AI-103` | Draft endpoint must use common response envelope |
| AI-211 | `AI-103` -> `AI-100, AI-103` | Lint endpoint must implement blocking/override semantics |
| AI-212 | `AI-210, AI-211` -> `AI-100, AI-210, AI-211` | UX must enforce critical block + major acknowledge behavior |
| AI-213 | `AI-212` -> `AI-100, AI-212` | Evidence-linked diff behavior required |
| AI-214 | `AI-212` -> `AI-100, AI-212` | Regression tests must include lint-policy behavior |
| AI-220 | `AI-201, AI-211` -> `AI-100, AI-201, AI-211` | CI gates must enforce >=99% injection block + PHI leak zero tolerance |
| AI-221 | `AI-203, AI-212` -> `AI-100, AI-203, AI-212, AI-220` | Release gate now includes staging endpoint error rate `<1%` |
| AI-222 | `AI-107` -> `AI-100, AI-107` | Pilot runbook aligned to outpatient-first rollout |
| AI-230 | `AI-106` -> `AI-100, AI-106` | Scope explicitly limited to technical spike (no production rollout) |

## Delivery Gates (From Spec)

- Functional:
  - Priority features available behind role-aware flags.
  - Omni NL requires confirmation for sensitive actions.
- Security:
  - Endpoint-level access checks verified.
  - No PHI in logs.
  - Prompt-injection block rate `>=99%`.
  - Omni sensitive-intent classification `>=99%`.
- Performance:
  - Chronicle summary p95 and note lint p95 targets achieved.
  - No chronic regression to core clinical views.
  - Core AI endpoint staging error rate `<1%`.
- Clinical safety:
  - AI outputs labeled advisory/draft.
  - Human review required before chart write/sign-off.

## How To Use This File

- Create work items in your tracker using the ticket IDs above.
- Preserve dependency order before assigning sprint commitment.
- Treat Sprint 1 and Sprint 2 exit criteria as hard release gates.
- Keep implementation details aligned with `/Users/jebre/Desktop/hms/AI_INTEGRATION_SPEC.md` and `/Users/jebre/Desktop/hms/AI_INTEGRATION_AI100_DECISION_RECORD.md`.
