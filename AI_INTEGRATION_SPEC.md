# HMS AI Integration Specification

Date: February 21, 2026  
Status: Draft v1  
Owner: Product + Clinical Engineering + Security

## 1. Purpose

Define a complete, implementation-ready specification for AI capabilities in HMS, with strict clinical safety, PHI protection, role-based access, and predictable performance.

This spec covers:
- Platform architecture for AI services in HMS.
- Feature-level specs for all proposed AI integrations.
- Deep implementation detail for priority features:
  - `#1` Chronicle Copilot
  - `#3` Clinical Note Draft/Linter
  - `#6` Lab Interpretation Assistant
  - `#8` Natural-Language Omni Search/Commands
  - Ambient AI Scribe (template-aware transcription) as a core extension of `#3`.

## 2. Product Goals and Non-Goals

### Goals
- Reduce documentation burden and time-to-complete clinical workflows.
- Improve note quality/completeness while preserving clinician control.
- Surface contextual insights where users already work (Chronicle, labs, command palette, patient portal).
- Keep patient data secure with least-privilege access and full auditability.
- Keep clinical page performance stable (no synchronous blocking external calls in request path where avoidable).

### Non-Goals
- No autonomous diagnosis, prescribing, order signing, or discharge authorization.
- No hidden AI writes to chart; all chart writes require explicit human action.
- No broad, unscoped assistant with unrestricted data access.
- No PHI query logging or training on customer data.

## 3. Current HMS Integration Surfaces (Confirmed)

### Backend
- Chronicle context and timeline:
  - `backend/apps/clinical_notes/views.py`
  - `GET /api/clinical-notes/chronicle/{patient_id}/context/`
  - `GET /api/clinical-notes/chronicle/{patient_id}/timeline/`
- Note templates and entries:
  - `backend/apps/clinical_notes/views.py`
  - `backend/apps/clinical_notes/models.py`
  - `backend/apps/clinical_notes/urls.py`
  - Existing template render + revision + note version history APIs.
- Lab results:
  - `backend/apps/laboratory/views.py` (`LabResultViewSet`)
  - `backend/apps/laboratory/serializers.py` (`LabResultSerializer`, `LabResultListSerializer`)
- Omni search:
  - `backend/apps/core/views.py` (`omni_search`)
  - `backend/apps/core/urls.py` (`/api/search/omni/`)
  - `backend/apps/core/tests/test_omni_search.py` (query budget + no side effects).
- Access control:
  - `backend/apps/core/security.py`
  - `check_clinical_access`, `check_lab_access`, `check_demographics_access`, `get_access_flags`.
- Patient detail gating:
  - `backend/apps/patients/views.py` (`get_patient`, `break_glass`).
- Async/runtime infrastructure:
  - `backend/hms_backend/settings.py`
  - Celery + Redis + Channels present.

### Frontend
- Chronicle page and slide-overs:
  - `frontend/src/features/patients/pages/PatientChroniclePage.jsx`
  - `frontend/src/hooks/useChronicleContext.js`
  - `frontend/src/components/chronicle/AddNoteSlideOver.jsx`
  - `frontend/src/hooks/useNoteWorkflow.js`
  - `frontend/src/components/chronicle/DynamicWorkflowStep.jsx`
- Labs:
  - `frontend/src/features/laboratory/pages/LabResultsPage.jsx`
  - `frontend/src/hooks/useLabQueries.js`
- Omni search:
  - `frontend/src/shared/components/omni-search/OmniSearchDialog.jsx`
  - `frontend/src/shared/hooks/useOmniSearchResults.js`
  - `frontend/src/shared/api/omniSearch.js`
- Role model:
  - `frontend/src/shared/constants/roles.js`

### Gap Analysis (Current State)
- No existing AI orchestration app.
- No transcription/audio ingestion pipeline.
- No ASR/diarization/template-mapping infrastructure.
- No AI evaluation pipeline, confidence gating, or AI-specific audit tables.

## 4. AI Feature Portfolio (All Integrations)

## 4.1 #1 Chronicle Copilot (Priority A)
- Users: doctors, nurses, inpatient doctor, practitioner, physician (clinical roles only).
- Core jobs:
  - Summarize patient status from Chronicle context + timeline.
  - Answer scoped clinical questions using existing HMS records.
  - Generate “what changed since last encounter” and “overnight events” views.
- Primary integration points:
  - `PatientChroniclePage.jsx`
  - `useChronicleContext.js`
  - `clinical_notes/views.py` chronicle endpoints.

## 4.2 #2 Inbox/Task Triage Assistant (Priority B)
- Users: clinicians, admin operations.
- Core jobs:
  - Triage inbox tasks by urgency.
  - Draft safe action suggestions (never execute without confirmation).
- Integration points:
  - Existing inbox feature + role dashboards.

## 4.3 #3 Clinical Note Draft + Quality Linter (Priority A)
- Users: clinicians writing notes.
- Core jobs:
  - Draft note sections from context (structured by template revision).
  - Lint for completeness, contradiction, missing sections, ambiguous phrasing.
  - Suggest safer wording and required fields before sign-off.
- Integration points:
  - `AddNoteSlideOver.jsx`
  - `useNoteWorkflow.js`
  - template render/revision APIs in `clinical_notes`.

## 4.4 #4 Referral and Handoff Summarizer (Priority B)
- Users: referring clinicians, receiving teams.
- Core jobs:
  - Produce concise referral summaries from timeline and current plan.
  - Suggest standardized handoff format (SBAR-like output).
- Integration points:
  - referrals + chronicle timeline.

## 4.5 #5 Patient Education and Discharge Simplifier (Priority B)
- Users: clinicians + patients.
- Core jobs:
  - Convert clinician plan into patient-readable instructions.
  - Generate language-level variants and follow-up reminders.
- Integration points:
  - discharge workflows, patient portal surfaces.

## 4.6 #6 Lab Interpretation Assistant (Priority A)
- Users: clinicians and lab staff.
- Core jobs:
  - Interpret abnormal/critical results in patient context.
  - Trend-aware explanation and suggested follow-up checks.
  - Produce patient-safe explanation variant.
- Integration points:
  - `LabResultsPage.jsx`
  - `LabResultViewSet`
  - Chronicle timeline (for contextual references).

## 4.7 #7 Revenue/Admin Copilot (Priority C)
- Users: billing/admin.
- Core jobs:
  - Summarize denial reasons and suggest missing documentation.
  - Predict likely claim issues using local record completeness.
- Integration points:
  - billing workflows and patient demographics access boundaries.

## 4.8 #8 Natural-Language Omni Search and Commands (Priority A)
- Users: all roles (commands role-gated).
- Core jobs:
  - Parse free text intent into existing search types/actions.
  - Route users faster to patient/chart/lab flows with permission checks.
- Integration points:
  - `OmniSearchDialog.jsx`, `omniActions.js`, `/api/search/omni/`.

## 4.9 Ambient AI Scribe (Priority A, Extension of #3)
- Users: clinicians during encounters/rounds.
- Core jobs:
  - Capture ambient/dictated conversation.
  - Transcribe with speaker separation.
  - Map transcript evidence into selected note template sections.
  - Produce editable note draft with explicit evidence links.
- Integration points:
  - `AddNoteSlideOver.jsx` and workflow/template APIs.
  - Chronicle encounter context.

## 5. Target Architecture

## 5.1 New Backend App

Create `backend/apps/ai/` with:
- `models.py`: AI sessions, artifacts, scribe entities, feedback, policy decisions.
- `serializers.py`: strict allowlist payloads.
- `views.py`: DRF endpoints with security checks.
- `services/`:
  - `orchestrator.py`
  - `policy.py`
  - `retrieval.py`
  - `providers/llm.py`
  - `providers/asr.py`
  - `prompting.py`
- `tasks.py`: Celery tasks for ASR, summarization, mapping, linting.
- `urls.py`: API routes under `/api/ai/`.

## 5.2 Request Flow Pattern

1. UI sends scoped request (`patient_id`, `feature`, optional `encounter_id`).
2. API enforces:
   - facility scope (`get_user_facility`)
   - role scope
   - patient scope (`check_clinical_access` or `check_lab_access`).
3. Retrieval service builds minimal context bundle (no raw data overfetch).
4. Policy guard validates safe prompt + allowable tools for role.
5. Model call executes via provider abstraction.
6. Response passes output guardrails:
   - safety checks
   - hallucination heuristics
   - confidence score.
7. Return result as non-final draft with required human confirmation.
8. Persist audited artifact metadata (no PHI in logs).

## 5.3 Async Pattern

Use Celery for:
- Long summaries.
- Scribe chunk transcription.
- Template mapping.
- Lab interpretation batch generation.
- Re-indexing and evaluation jobs.

No external AI provider blocking on critical request path where async can be used.

## 5.4 Model Strategy and Hosting Architecture

## 5.4.1 Model Roles (By Capability)

Define stable internal model roles so providers/models can be swapped without product changes:

- `reasoner_large`
  - Use cases: Chronicle deep Q&A, complex longitudinal summaries, multi-source synthesis.
  - Requirements: high reasoning quality, long context, strong instruction following.
- `writer_medium`
  - Use cases: note drafting, lab explanation generation, patient-friendly rewrites.
  - Requirements: lower latency and cost than `reasoner_large`, high structured-output reliability.
- `validator_small`
  - Use cases: lint checks, contradiction detection, schema repair, intent confidence checks.
  - Requirements: very low latency, high deterministic behavior.
- `intent_small`
  - Use cases: Omni NL parsing to structured intent/entities.
  - Requirements: sub-second latency target, strict JSON output.
- `embedding_model`
  - Use cases: retrieval index for timeline/note/lab snippets and semantic lookup.
  - Requirements: strong medical-domain semantic retrieval, multilingual capability.
- `reranker_model`
  - Use cases: rank top retrieved passages before generation.
  - Requirements: high precision top-k relevance.
- `asr_medical`
  - Use cases: ambient transcription and dictation.
  - Requirements: medical vocabulary support, punctuation, speaker diarization compatibility.
- `diarizer`
  - Use cases: speaker segmentation (`clinician`, `patient`, `other/unknown`).
  - Requirements: robust short-window diarization on noisy clinic audio.

## 5.4.2 Feature-to-Model Mapping

| Feature | Primary Model Role | Secondary Roles |
|---|---|---|
| #1 Chronicle Copilot | `reasoner_large` | `embedding_model`, `reranker_model`, `validator_small` |
| #3 Note Draft | `writer_medium` | `embedding_model`, `reranker_model` |
| #3 Note Lint | `validator_small` | `writer_medium` (suggested rewrites) |
| Ambient Scribe | `asr_medical` | `diarizer`, `writer_medium`, `validator_small` |
| #6 Lab Interpretation | `writer_medium` | `validator_small`, `embedding_model` |
| #8 Omni NL | `intent_small` | `validator_small` |

## 5.4.3 Hosting Topology Options

### Option A: Fully Managed Inference (HIPAA/BAA-capable provider)
- Pros: fastest to launch, minimal MLOps burden, high-quality frontier models.
- Cons: recurring API cost, external dependency, provider data-governance constraints.

### Option B: Self-Hosted Inference (GPU)
- Pros: maximum control, predictable unit economics at scale, full data residency control.
- Cons: higher ops complexity (GPU autoscaling, model serving, upgrades).

### Option C: Hybrid (Recommended)
- Managed for `reasoner_large` and selective `writer_medium` workloads.
- Self-hosted for high-volume predictable tasks:
  - `asr_medical`
  - `intent_small`
  - embeddings/reranking where feasible.

Rationale:
- Keeps quality high for critical reasoning tasks.
- Controls cost and latency on high-throughput tasks (scribe + intent + retrieval).
- Reduces vendor lock-in by preserving internal model roles.

## 5.4.4 Recommended Deployment Layout

- HMS control plane (existing Railway deployment):
  - Django API
  - AI orchestration endpoints (`apps/ai`)
  - Celery orchestration workers
  - Redis broker/cache
  - Postgres metadata/audit store
- AI inference plane (separate from Railway app runtime):
  - Managed LLM endpoints over private networking where possible
  - Dedicated GPU workers/services for ASR + diarization + optional open models
  - Vector index service (Postgres pgvector or dedicated vector DB)
  - Encrypted object storage for scribe audio chunks/transcripts

Important:
- Do not assume Railway runtime should host heavy GPU inference.
- Keep model-serving stack isolated from core HMS request-serving processes.

## 5.4.5 Model Router Design (Backend)

Add `backend/apps/ai/services/model_router.py`:

- Inputs:
  - feature type
  - task subtype
  - latency budget
  - user role
  - patient/context size
- Outputs:
  - selected `model_role`
  - concrete provider model id
  - timeout and retry policy
  - fallback chain.

Routing policies:
- Safety-critical narrative tasks: prefer higher-quality models.
- Simple parsing/classification: force low-latency small models.
- If context > threshold:
  - summarize/retrieve first, then call generation model.

## 5.4.6 Fallback and Resilience

Per model role define:
- `primary_model`
- `secondary_model`
- `degraded_mode`

Examples:
- `reasoner_large` outage:
  - fallback to `writer_medium` + strict citation requirement
  - or return “summary unavailable” with manual checklist.
- `asr_medical` outage:
  - allow manual dictation text entry path.
- `intent_small` outage:
  - revert Omni to existing operator/query mode.

## 5.4.7 Data Governance With External Models

Mandatory controls:
- BAA/DPA in place for any external inference provider.
- “No training on customer data” contract clauses enforced.
- Transport encryption and at-rest encryption.
- Prompt/response retention controls configurable per deployment.
- Regional routing/data residency configuration per facility jurisdiction.

## 5.4.8 Prompt and Model Versioning

Track versions on every artifact:
- `prompt_version`
- `model_role`
- `provider_model_id`
- `policy_version`
- `schema_version`

This enables:
- reproducibility
- rollback
- quality audits by model version.

## 5.4.9 Cost and Throughput Controls

- Hard token budgets per request and per feature.
- Daily spend guardrails per facility.
- Response caching for repeated summary prompts.
- Chunk deduplication for scribe via `sha256` before transcription.
- Queue partitioning:
  - realtime tasks (scribe live updates)
  - batch tasks (background summarization/evals).

## 5.4.10 Minimum Initial Model Stack (Pragmatic Launch)

Launch with three concrete lanes:

1. High-quality text generation lane:
- powers `reasoner_large` and complex `writer_medium` tasks.

2. Fast utility lane:
- powers `intent_small` and `validator_small`.

3. Speech lane:
- `asr_medical` + diarization pipeline dedicated to ambient scribe.

This minimizes integration complexity while still allowing role-based model routing and fallback.

## 5.4.11 Concrete Model Candidates (Initial)

Final selection must pass security/compliance and clinical evals, but this is the initial candidate set:

| Model Role | Managed Candidate Class | Self-Hosted Candidate Class |
|---|---|---|
| `reasoner_large` | Frontier reasoning model tier (enterprise/BAA) | 70B+ instruct model tier |
| `writer_medium` | Fast high-quality assistant model tier | 32B-70B instruct model tier |
| `validator_small` | Low-latency compact assistant tier | 7B-14B instruct model tier |
| `intent_small` | Compact JSON-reliable assistant tier | 7B-14B instruct model tier |
| `embedding_model` | Enterprise embedding endpoint | `bge`/equivalent embedding family |
| `reranker_model` | Enterprise reranker endpoint | `bge-reranker`/cross-encoder class |
| `asr_medical` | Managed medical ASR service | Whisper-large-v3 class |
| `diarizer` | Managed diarization service | pyannote-class diarization |

Notes:
- Keep provider/model IDs behind config variables; do not hardcode in business logic.
- For ambient scribe launch, prioritize ASR accuracy over lowest cost.

## 6. Data Model Specification

## 6.1 Core AI Tables

1. `AISession`
- `id`, `facility_id`, `user_id`, `patient_id` nullable, `encounter_id` nullable
- `feature` enum (`chronicle_copilot`, `note_lint`, `lab_interpretation`, `omni_nl`, `scribe`, etc.)
- `status`, `started_at`, `ended_at`
- `request_context_hash` (for dedupe/audit)

2. `AIMessage`
- `id`, `session_id`, `role`, `content_encrypted`, `content_redacted`
- `model_name`, `provider`, `input_tokens`, `output_tokens`, `latency_ms`
- `created_at`

3. `AIArtifact`
- `id`, `session_id`, `artifact_type`
- `payload_json` (structured output)
- `confidence_score`
- `requires_human_review` default true
- `accepted_by`, `accepted_at`, `rejected_reason`
- Optional links: `note_entry_id`, `lab_result_id`, `timeline_event_id`

4. `AIFeedback`
- `id`, `artifact_id`, `user_id`, `thumb` (`up/down`), `comment`, `created_at`

## 6.2 Ambient Scribe Tables

1. `AIScribeSession`
- `id`, `facility_id`, `patient_id`, `encounter_id`, `user_id`
- `template_id`, `template_revision_id`
- `mode` (`ambient`, `dictation`)
- `status` (`starting`, `recording`, `processing`, `ready`, `failed`, `stopped`)
- `consent_captured`, `consent_timestamp`
- `started_at`, `stopped_at`

2. `AIScribeChunk`
- `id`, `session_id`, `sequence_number`
- `audio_uri_encrypted`, `duration_ms`, `sha256`
- `ingested_at`, `processed_at`, `status`

3. `AIScribeSegment`
- `id`, `session_id`, `chunk_id`, `speaker_label`
- `start_ms`, `end_ms`, `text`, `confidence`

4. `AIScribeTemplateDraft`
- `id`, `session_id`, `section_key`, `section_title`
- `draft_text`, `evidence_segment_ids`, `confidence`
- `updated_at`

5. `AIScribeAudit`
- `id`, `session_id`, `action`, `user_id`, `timestamp`, `metadata`

## 6.3 Indexes and Constraints

- Composite indexes:
  - `(facility_id, feature, created_at desc)` on `AISession`
  - `(session_id, created_at)` on `AIMessage`
  - `(session_id, artifact_type)` on `AIArtifact`
  - `(session_id, sequence_number)` unique on `AIScribeChunk`
  - `(session_id, section_key)` unique on `AIScribeTemplateDraft`
- Data retention fields for scheduled purge jobs.

## 7. API Specification

## 7.1 Common AI APIs

- `POST /api/ai/sessions/`
  - Start session.
- `POST /api/ai/sessions/{id}/ask/`
  - Ask question; supports streaming.
- `GET /api/ai/sessions/{id}/artifacts/`
  - Fetch generated drafts/summaries/lints.
- `POST /api/ai/artifacts/{id}/accept/`
  - Explicit user acceptance.
- `POST /api/ai/artifacts/{id}/reject/`
  - Explicit rejection + reason.

## 7.2 #1 Chronicle Copilot APIs

- `POST /api/ai/chronicle/{patient_id}/summarize/`
  - Inputs: `time_window`, `focus` (`handoff`, `rounds`, `changes`), optional `encounter_id`
  - Output: structured summary blocks + citations (timeline ids).
- `POST /api/ai/chronicle/{patient_id}/ask/`
  - Inputs: natural language question + optional constraints.
  - Output: answer + confidence + citations.

## 7.3 #3 Note Draft + Lint APIs

- `POST /api/ai/notes/draft/`
  - Inputs: `patient_id`, `template_id`, `template_revision_id`, `encounter_id`, optional prompt.
  - Output: section-keyed draft aligned to template.
- `POST /api/ai/notes/lint/`
  - Inputs: note draft JSON + template revision.
  - Output: issues list:
    - `severity` (`critical`, `major`, `minor`)
    - `section`
    - `message`
    - `suggested_fix`.

## 7.4 Ambient Scribe APIs

- `POST /api/ai/scribe/sessions/start/`
  - Inputs: `patient_id`, `encounter_id`, `template_id`, `template_revision_id`, `mode`, `language`.
  - Enforces clinical access and explicit consent.
- `POST /api/ai/scribe/sessions/{id}/chunks/`
  - Upload audio chunk metadata + file reference.
- `POST /api/ai/scribe/sessions/{id}/stop/`
  - Finalize recording.
- `GET /api/ai/scribe/sessions/{id}/transcript/`
  - Returns merged transcript + speaker turns.
- `GET /api/ai/scribe/sessions/{id}/template-draft/`
  - Returns live section mapping aligned to note template.
- `POST /api/ai/scribe/sessions/{id}/finalize-note/`
  - Writes draft into note workflow (not signed, editable).

## 7.5 #6 Lab Interpretation APIs

- `POST /api/ai/labs/interpret/`
  - Inputs: `result_id` or `order_id`, `audience` (`clinician`, `patient`)
  - Output:
    - interpretation summary
    - confidence
    - suggested next checks (non-ordering, advisory only)
    - citations to result fields/trends.

## 7.6 #8 Omni NL APIs

- `POST /api/ai/omni/parse/`
  - Input: free text command.
  - Output: structured intent:
    - `intent_type`
    - `entities`
    - `target_route`
    - `requires_confirmation`.
- `POST /api/ai/omni/execute-preview/`
  - Server-side permission check and dry-run only.

## 8. Frontend UX Specification

## 8.1 Chronicle Copilot UX

- Add right-side “Ask Chronicle” panel in `PatientChroniclePage.jsx`.
- Quick prompts:
  - “Summarize last 24h”
  - “What changed since previous encounter?”
  - “Risks to monitor today”
- Responses must show cited source chips (timeline/note/lab ids).

## 8.2 Note Draft/Lint UX

- In `AddNoteSlideOver.jsx`:
  - “Generate Draft” button after template selection.
  - “Run Quality Check” before completion.
  - Section-level diff viewer: AI draft vs edited text.

## 8.3 Ambient Scribe UX

- In `AddNoteSlideOver.jsx`:
  - “Start Scribe” / “Pause” / “Stop”.
  - Live transcript strip.
  - Live template section fill with confidence badges.
  - Evidence links from section text to transcript timestamps.
- Safety UX:
  - Always-visible recording indicator.
  - Consent confirmation modal.
  - “AI Draft - Review Required” banner before save.

## 8.4 Lab Interpretation UX

- In `LabResultsPage.jsx`:
  - “Interpret” action on result row/order group.
  - Tabs:
    - Clinician interpretation
    - Patient-friendly explanation.

## 8.5 Omni NL UX

- Extend `OmniSearchDialog.jsx`:
  - Free-text intent mode in addition to current operators.
  - Show parsed intent preview before navigation/action.
  - Require confirm for sensitive actions.

## 9. Security, Privacy, and Compliance Requirements

## 9.1 Access Controls (Mandatory)

- Reuse existing controls on every AI endpoint:
  - `check_clinical_access` for clinical/note/scribe data.
  - `check_lab_access` for lab interpretation.
  - facility match via `get_user_facility`.
- Never trust frontend flags (`access` is optimization only).

## 9.2 PHI Handling

- Do not log raw prompts/responses with PHI in application logs.
- Encrypt persisted AI message content and transcript storage.
- Tokenized/redacted telemetry only.
- Vendor contracts must include BAA and “no training on customer data.”

## 9.3 Clinical Safety Guardrails

- All AI outputs are advisory.
- No direct order or prescription execution.
- Human sign-off required for any chart write.
- Output must include uncertainty/confidence and evidence references.

## 9.4 Ambient Scribe Compliance

- Explicit consent capture at session start.
- Visible recording state at all times.
- Configurable retention:
  - raw audio short retention (recommended 24-72h)
  - transcript longer retention per policy.
- Emergency stop and immediate deletion workflow for accidental capture.

## 10. Performance and Reliability SLOs

- Chronicle copilot:
  - first token <= 1.5s p95 (streaming mode)
  - full response <= 8s p95 for standard summary prompts.
- Note lint:
  - <= 3s p95 for typical note payload.
- Lab interpretation:
  - <= 2.5s p95 for single result; <= 6s for order batch.
- Ambient scribe:
  - transcript update lag <= 5s p95 from chunk ingest.
  - section mapping refresh <= 10s p95.
- System reliability:
  - provider timeout + retry with circuit breaker.
  - graceful fallback message on provider outage.

## 11. Observability and Evaluation

## 11.1 Telemetry

- Metrics:
  - request count, error rate, latency, token usage, cost per feature.
  - scribe chunk backlog and processing lag.
- Dashboards by feature and facility.
- Structured audit events for each AI artifact lifecycle.

## 11.2 Quality Evaluation

- Offline eval sets per feature:
  - chronicle summaries
  - note section mapping
  - lab interpretation quality
  - omni intent parsing accuracy.
- Online feedback loops:
  - accept/reject rates
  - clinician edits delta
  - flagged safety issues.

## 12. Implementation Plan

## Phase 0: Foundations (2-3 weeks)
- Create `apps/ai` with provider abstraction, policy layer, base models, API scaffolding.
- Add feature flags and configuration.
- Add audit and retention jobs.

## Phase 1: Priority Features (6-8 weeks)
- `#1` Chronicle Copilot.
- `#3` Note Draft + Lint.
- Ambient Scribe MVP (transcript + template mapping + finalize draft).
- `#6` Lab Interpretation.
- `#8` Omni NL parse + preview.

## Phase 2: Extended Capabilities (4-6 weeks)
- `#2` inbox triage.
- `#4` referral/handoff summarizer.
- `#5` patient education/discharge simplifier.
- Patient portal assistant patterns.

## Phase 3: Operations and Optimization (ongoing)
- Cost tuning, caching, prompt optimization, model routing.
- Broader role-based expansion and multilingual improvements.

## 13. Testing Strategy

## 13.1 Backend
- Unit tests: policy enforcement, prompt builders, parsing, mapping, retention jobs.
- Integration tests:
  - permission-denied and facility mismatch scenarios.
  - AI artifact lifecycle accept/reject.
  - scribe chunk ingest -> transcript -> template mapping -> note finalize.
- Query count tests on hot endpoints.

## 13.2 Frontend
- Component tests:
  - Chronicle copilot panel
  - note lint UI
  - scribe controls and session state
  - omni intent preview.
- E2E tests for full encounter documentation flow.

## 13.3 Safety Tests
- Prompt injection attempts.
- PHI leakage checks in logs/telemetry.
- Hallucination stress prompts with known-ground-truth fixtures.

## 14. Acceptance Criteria (Go-Live)

## Functional
- All priority features available behind role-aware flags.
- Scribe can produce template-mapped draft and finalize into editable note entry.
- Omni NL parser routes correctly with confirmation for sensitive actions.

## Security
- 100% endpoint-level access checks verified in tests.
- No PHI in logs from AI endpoints.
- Retention and deletion workflows operational.

## Performance
- Meets SLOs in staging load test.
- No measurable regression to Chronicle or lab page baseline p95 render/API performance.

## Clinical Safety
- AI output clearly labeled as draft/advisory.
- Human review mandatory before save/sign.
- Safety review sign-off from clinical governance.

## 15. Required Configuration and Feature Flags

Recommended environment variables:
- `AI_ENABLED`
- `AI_HOSTING_MODE` (`managed` | `self_hosted` | `hybrid`)
- `AI_PROVIDER` (primary text provider)
- `AI_PROVIDER_SECONDARY` (fallback text provider)
- `AI_MODEL_REASONER_PRIMARY`
- `AI_MODEL_REASONER_FALLBACK`
- `AI_MODEL_WRITER_PRIMARY`
- `AI_MODEL_WRITER_FALLBACK`
- `AI_MODEL_VALIDATOR`
- `AI_MODEL_INTENT`
- `AI_MODEL_ASR_PRIMARY`
- `AI_MODEL_ASR_FALLBACK`
- `AI_MODEL_EMBEDDING`
- `AI_MODEL_RERANKER`
- `AI_PROVIDER_BASE_URL`
- `AI_PROVIDER_API_KEY`
- `AI_PROVIDER_REGION`
- `AI_PROVIDER_ZERO_RETENTION`
- `AI_PROVIDER_PRIVATE_NETWORK_ENABLED`
- `AI_VECTOR_BACKEND` (`pgvector` | `external`)
- `AI_VECTOR_INDEX_URL` (if external)
- `AI_OBJECT_STORAGE_BUCKET_AUDIO`
- `AI_OBJECT_STORAGE_BUCKET_TRANSCRIPTS`
- `AI_OBJECT_STORAGE_KMS_KEY_ID`
- `AI_REQUEST_TIMEOUT_MS`
- `AI_REQUEST_TIMEOUT_ASR_MS`
- `AI_MAX_CONTEXT_TOKENS`
- `AI_MAX_OUTPUT_TOKENS`
- `AI_MAX_AUDIO_CHUNK_SECONDS`
- `AI_SCRIBE_REALTIME_QUEUE`
- `AI_BATCH_QUEUE`
- `AI_AUDIO_RETENTION_DAYS`
- `AI_TRANSCRIPT_RETENTION_DAYS`
- `AI_NO_TRAINING_ENFORCED`

Feature flags:
- `AI_CHRONICLE_COPILOT_ENABLED`
- `AI_NOTE_DRAFT_ENABLED`
- `AI_NOTE_LINT_ENABLED`
- `AI_AMBIENT_SCRIBE_ENABLED`
- `AI_LAB_INTERPRET_ENABLED`
- `AI_OMNI_NL_ENABLED`
- `AI_PATIENT_ASSIST_ENABLED`

## 16. Open Decisions (Need Product/Security Sign-Off)

1. Ambient scribe default retention duration by deployment tier.
2. Whether to persist raw transcript forever or retain only note-linked excerpts after sign-off.
3. Allowed external providers per region/jurisdiction.
4. Patient portal assistant scope at launch (education only vs broader Q&A).
5. Rollout cohort order (outpatient clinic first vs inpatient ward first).

## 17. Role-to-Feature Access Matrix

| Role | #1 Chronicle | #2 Inbox Triage | #3 Note Draft/Lint | Ambient Scribe | #6 Lab Interpret | #8 Omni NL |
|---|---|---|---|---|---|---|
| Admin | Yes (audited) | Yes | Yes | Yes | Yes | Yes |
| Doctor/Physician/Practitioner/Inpatient Doctor | Yes | Yes | Yes | Yes | Yes | Yes |
| Nurse/Head Nurse/Nurse Practitioner | Yes | Yes | Yes (nursing scope) | Yes | Yes (per lab access rules) | Yes |
| Lab Technician | No clinical chronicle | Limited (lab queue only) | No | No | Yes | Yes (lab-scoped intents only) |
| Receptionist | No | Limited (front desk tasks) | No | No | No | Yes (demographic/scheduling only) |
| Billing | No | Billing tasks only | No | No | No | Yes (billing-scoped intents only) |
| Patient | Self-summary only (portal mode) | N/A | No provider note drafting | No | Self-result explanation only | Limited self-service intents |

Enforcement model:
- UI role gating for discoverability.
- Backend authorization on every endpoint as source of truth.
- Patient-facing AI must only use self-owned records.

## 18. Ambient Scribe Detailed Workflow

## 18.1 Session Lifecycle

1. Clinician opens note workflow and selects template revision.
2. User starts scribe session with consent confirmation.
3. Frontend records audio in chunks (recommended 10s, max 20s).
4. Each chunk uploads and triggers async transcription task.
5. Transcript segments append to live stream (with speaker labels).
6. Section mapper updates template draft per new transcript evidence.
7. Clinician can edit any section at any time.
8. On stop, system runs final normalization + lint.
9. Finalize action creates editable note draft (never auto-sign).

## 18.2 Mapping Strategy to Desired Note Templates

- Input:
  - published template revision content
  - transcript segments
  - chronicle context (allergies, meds, problems, recent labs).
- Mapper behavior:
  - classify segments to target section keys
  - preserve evidence links (`segment_id[]`) per generated section text
  - avoid over-writing manually edited sections unless user accepts overwrite
  - keep unknown data in an “Unmapped Transcript” bucket for manual review.
- Output format:
  - strict JSON keyed by template section names to fit existing `NoteEntry.data`.

## 18.3 Speaker and Evidence Requirements

- Minimum speaker labels:
  - `clinician`
  - `patient`
  - `other/unknown`
- Every generated section must carry:
  - confidence score
  - transcript evidence references
  - timestamp range for replay.

## 18.4 Safety Requirements for Scribe

- Persistent recording indicator and elapsed timer.
- Explicit pause/resume controls.
- Prevent finalization if required template fields missing (use lint output).
- If confidence below threshold for a section, flag as “Needs Review.”

## 19. Prompting and Output Contract Standards

## 19.1 Prompt Policy

- System prompts must include:
  - role scope and allowed data domains
  - prohibited actions (no diagnosis certainty claims, no direct order execution)
  - required citation behavior.
- No prompt may include hidden instructions to bypass access control.
- Injected user content treated as untrusted data.

## 19.2 Structured Outputs

- All production AI endpoints return schema-validated JSON.
- Reject model output that does not parse/validate.
- Version schemas (`schema_version`) to support safe evolution.

## 19.3 Example Output Envelope

```json
{
  "schema_version": "1.0",
  "feature": "note_lint",
  "confidence": 0.87,
  "citations": [{"type": "timeline_event", "id": "uuid"}],
  "result": {},
  "requires_human_review": true
}
```

## 20. Failure Modes and Fallback Behavior

1. Provider timeout:
   - return non-blocking error state with retry option.
2. Provider outage:
   - circuit breaker open; disable impacted feature flag for facility if threshold exceeded.
3. Chunk upload failure in scribe:
   - local retry queue; if unrecoverable, mark gap in transcript and continue.
4. Access revoked mid-session:
   - terminate session, revoke artifact fetch, log security event.
5. Template revision changed during active scribe:
   - keep session pinned to original revision; warn on finalize if newer revision exists.
6. Encounter closed before finalize:
   - allow draft save but require clinician to select valid encounter before completion.

## 21. Rollout, Migration, and Rollback

## 21.1 Rollout

- Feature flags by facility + role.
- Start with pilot cohort (single unit), then expand.
- Daily clinical safety review during pilot window.

## 21.2 Migration Plan

- Add `apps/ai` migrations with indexes and retention fields.
- No destructive migrations in first release.
- Add Celery queues:
  - `ai_realtime`
  - `ai_batch`
  - `ai_maintenance`.

## 21.3 Rollback Plan

- Disable feature flags immediately.
- Keep read-only access to previously generated artifacts.
- Stop scribe ingestion workers; allow pending tasks to drain or hard-cancel based on incident severity.

## 22. Definition of Done Checklist

- Product:
  - UX approved for Chronicle, Notes, Labs, Omni, and Scribe.
- Security:
  - Threat model completed.
  - PHI logging validation passed.
- Engineering:
  - API schemas locked.
  - Query/perf tests passing.
  - Monitoring dashboards active.
- Clinical:
  - Safety review sign-off.
  - Pilot feedback incorporated.
- Operations:
  - Runbooks for incident response and vendor failover published.

---

This specification is aligned to current HMS architecture and existing access-control model, and is structured to let implementation start immediately with Phase 0 foundations and Phase 1 priority features.
