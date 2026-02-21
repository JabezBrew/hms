# AI Integration Backlog Plan (CSV Replacement)

Date: February 21, 2026  
Source: `/Users/jebre/Desktop/hms/AI_INTEGRATION_SPEC.md`

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
| AI-100 | P0 | Finalize AI governance decisions | Product + Security | 3 | - | Hosting/provider/retention/pilot decisions signed |
| AI-101 | P0 | Scaffold `apps/ai` and route registration | Backend | 3 | AI-100 | `/api/ai/*` endpoints available with auth/facility context |
| AI-102 | P0 | Implement model router and provider interfaces | Backend | 5 | AI-101 | Router returns model role + timeout/retry/fallback |
| AI-103 | P0 | Create AI core models and migrations | Backend | 5 | AI-101 | `AISession`, `AIMessage`, `AIArtifact`, `AIFeedback` live |
| AI-104 | P0 | Implement PHI-safe logging/redaction controls | Backend + Security | 5 | AI-101 | No raw PHI in AI logs |
| AI-105 | P1 | Add AI feature flags and env wiring | Backend + Ops | 3 | AI-101 | Runtime toggles and config validation complete |
| AI-106 | P1 | Configure Celery AI queues and retries | Backend + Ops | 3 | AI-105 | `ai_realtime`, `ai_batch`, `ai_maintenance` operational |
| AI-107 | P1 | Add baseline AI observability dashboards | Ops + Backend | 5 | AI-102 | Latency/errors/tokens/cost dashboards available |
| AI-120 | P0 | Build Omni NL parse endpoint | Backend | 5 | AI-102 | `POST /api/ai/omni/parse/` schema-valid output |
| AI-121 | P0 | Build Omni execute-preview endpoint | Backend | 5 | AI-120 | `POST /api/ai/omni/execute-preview/` no-side-effect checks |
| AI-122 | P0 | Add Omni intent preview and confirmation UI | Frontend | 5 | AI-120, AI-121 | Parsed intent + confirm flow in command palette |
| AI-123 | P1 | Omni NL regression and perf tests | QA + BE + FE | 3 | AI-122 | Existing omni behavior preserved, p95 targets met |
| AI-130 | P0 | Build Lab Interpretation endpoint | Backend | 5 | AI-102 | `POST /api/ai/labs/interpret/` with confidence + citations |
| AI-131 | P0 | Add Lab Interpret actions in UI | Frontend | 5 | AI-130 | Row/order interpret actions by role |
| AI-132 | P0 | Add lab safety policy guardrails | Backend | 3 | AI-130 | Advisory-only behavior enforced |
| AI-133 | P1 | Lab interpretation fixtures and tests | QA + Backend | 3 | AI-130 | Normal/abnormal/critical coverage in integration tests |

## Sprint 1 Exit Criteria

- Omni NL and Lab Interpretation function end-to-end behind flags.
- Access-control and PHI-log safety tests pass.
- AI queueing and observability are active in staging.

## Sprint 2 Backlog

| Ticket | Priority | Title | Owner | Points | Depends On | Outcome |
|---|---|---|---|---:|---|---|
| AI-200 | P0 | Build Chronicle retrieval context service | Backend | 5 | AI-103 | Role/facility scoped context bundle with citations |
| AI-201 | P0 | Build Chronicle summarize endpoint | Backend | 5 | AI-200 | `POST /api/ai/chronicle/{patient_id}/summarize/` |
| AI-202 | P0 | Build Chronicle ask endpoint | Backend | 5 | AI-200 | `POST /api/ai/chronicle/{patient_id}/ask/` |
| AI-203 | P0 | Add Chronicle Copilot panel and prompts | Frontend | 5 | AI-201, AI-202 | Copilot panel integrated in Chronicle page |
| AI-210 | P0 | Build Note Draft endpoint | Backend | 5 | AI-103 | `POST /api/ai/notes/draft/` aligned to template revisions |
| AI-211 | P0 | Build Note Lint endpoint | Backend | 5 | AI-103 | `POST /api/ai/notes/lint/` with severity + fixes |
| AI-212 | P0 | Add Generate Draft and Run Quality Check UI | Frontend | 5 | AI-210, AI-211 | Draft/lint integrated in Add Note workflow |
| AI-213 | P1 | Add section diff and evidence UI | Frontend | 5 | AI-212 | AI vs clinician edits reviewable before save |
| AI-214 | P1 | Add note workflow regression tests | QA + BE + FE | 3 | AI-212 | Note create/update/history behavior unchanged |
| AI-220 | P0 | Build AI safety evaluation harness | Security + Backend | 5 | AI-201, AI-211 | Prompt injection/hallucination gates in CI |
| AI-221 | P0 | Run load and latency tests | QA + Ops | 3 | AI-203, AI-212 | Chronicle/note AI SLO targets met in staging |
| AI-222 | P1 | Publish pilot runbook and fallback procedures | Ops + Security | 3 | AI-107 | Kill-switch/outage/rollback playbook approved |
| AI-230 | P1 | Ambient scribe technical spike | Backend + Frontend | 5 | AI-106 | ASR/diarization benchmark report with recommendation |
| AI-231 | P1 | Ambient scribe consent UX + policy review | Frontend + Product + Security | 3 | AI-100 | Consent flow approved for implementation |

## Sprint 2 Exit Criteria

- Chronicle Copilot and Note Draft/Lint are pilot-ready behind feature flags.
- Performance and safety gates pass staging validation.
- Ambient scribe has a validated technical recommendation and approved consent design.

## Delivery Gates (From Spec)

- Functional:
  - Priority features available behind role-aware flags.
  - Omni NL requires confirmation for sensitive actions.
- Security:
  - Endpoint-level access checks verified.
  - No PHI in logs.
- Performance:
  - Chronicle summary p95 and note lint p95 targets achieved.
  - No chronic regression to core clinical views.
- Clinical safety:
  - AI outputs labeled advisory/draft.
  - Human review required before chart write/sign-off.

## How To Use This File

- Create work items in your tracker using the ticket IDs above.
- Preserve dependency order before assigning sprint commitment.
- Treat Sprint 1 and Sprint 2 exit criteria as hard release gates.
- Keep implementation details aligned with `/Users/jebre/Desktop/hms/AI_INTEGRATION_SPEC.md`.
