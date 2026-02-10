# Admin Dashboard v2 Draft

Status: Accepted and revised after design review  
Scope: `/dashboards/admin` redesign (UI + data contract)  
Audience: Hospital operations admins  
Design: Chronicle Design System.

## 1. Product Intent

The admin dashboard is an operations command center.

Primary questions:
- What requires action now?
- What will break in the next 2 hours?
- What is trending toward risk today?

## 2. Scope Boundaries

Main admin dashboard (`/dashboards/admin`):
- Operations and compliance only.
- No engineering/SRE internals as primary content.

Technical system dashboard (separate page, linked from Admin tools):
- API latency, queue backlog, cache internals, retry controls.
- Proposed route: `/admin/system-operations`.

## 3. Design Principles

- Action-first, not report-first.
- No patient-identifiable data on landing.
- Summary-first payload, details on demand.
- Facility-scoped by default.
- Fast by default: cache + websocket invalidation + bounded lists.

## 4. Information Architecture

Desktop layout:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Header: Facility | Time Window | Last Updated | Refresh | Settings│
├────────────────────────────────────────────────────────────────────┤
│ Critical Alert Strip (operations + compliance only)               │
├────────────────────────────────────────────────────────────────────┤
│ KPI 1 | KPI 2 | KPI 3 | KPI 4 | KPI 5 | KPI 6                     │
├───────────────────────────────┬────────────────────────────────────┤
│ Capacity & Flow               │ Workforce & Coverage               │
│ - Occupancy                   │ - Coverage summary                 │
│ - Admissions/Discharges       │ - Uncovered critical shifts        │
│ - Wait-time risk              │ - Next staffing risks              │
├───────────────────────────────┼────────────────────────────────────┤
│ Compliance Snapshot           │ Action Queue                       │
│ - Break-glass pending review  │ - Prioritized tasks                │
│ - Audit anomalies             │ - Direct links                     │
└───────────────────────────────┴────────────────────────────────────┘
```

Mobile layout:
- Header and alert strip pinned.
- KPI cards become horizontal scroll chips.
- Sections become stacked accordions in this order:
1. Capacity & Flow
2. Workforce & Coverage
3. Compliance Snapshot
4. Action Queue

## 5. Module Specs

### A. Critical Alert Strip

Show max 5 items, sorted by severity then recency.

Include:
- Bed occupancy critical threshold breached
- Uncovered critical shift
- Break-glass review SLA breach
- Audit anomaly spike

Each item includes:
- `severity`: `critical | warning`
- short message
- age
- one primary action (`View`, `Escalate`, `Assign`)

### B. KPI Row (max 6 cards)

1. Occupancy
- Value: overall percent
- Subtitle: occupied/total beds
- Action: `Open bed board`

2. Admissions Today
- Value: count
- Subtitle: trend vs previous day
- Action: `Open admissions`

3. Discharges Today
- Value: planned vs completed
- Subtitle: completion rate
- Action: `Open discharge workflow`

4. Appointment Throughput
- Value: completed / scheduled
- Subtitle: completion rate
- Action: `Open appointments`

5. Staffing Coverage
- Value: filled / required shifts
- Subtitle: uncovered critical shifts
- Action: `Open roster`

6. Compliance Risk
- Value: open compliance risks
- Subtitle: break-glass + audit anomalies
- Action: `Open audit logs`

### C. Capacity & Flow

Summary widgets:
- Ward occupancy summary
- Admissions vs discharges summary (today)
- Wait-time risk indicator (median + p95)

Default view:
- Summary only on landing.
- Full chart/ward list fetched on panel expand.

### D. Workforce & Coverage

Summary widgets:
- Coverage summary by department/ward
- Uncovered critical shifts (top 3 on landing)
- Next 2-hour risk count

Default view:
- Summary + top 3 only on landing.
- Full uncovered list fetched on panel expand.

### E. Compliance Snapshot

Summary widgets:
- Break-glass pending review
- Audit anomalies (24h)
- Documentation completeness aggregate

Default view:
- Aggregate only on landing.
- Full compliance queue fetched on drill-down.

### F. Action Queue

Show max 5 operational actions with severity and owner state.

Examples:
- Approve overflow bed plan
- Assign ICU night shift coverage
- Review break-glass events
- Resolve delayed discharge bottlenecks

## 6. Data We Explicitly Exclude

- Patient names, MRNs, notes, meds, labs, vitals.
- Free-text PHI from logs.
- Large raw tables by default.
- SRE technical internals on operations landing.

## 7. API Contract (Efficiency-first)

### 7.1 Root endpoint (summary only)

`GET /api/dashboards/admin-v2/`

Query params:
- `window`: `now | today | 7d` (default `today`)
- `expand`: comma-list of optional inline sections (`capacity`, `workforce`, `compliance`, `actions`)

Default response includes only:
- `meta`
- `alerts_top` (max 3)
- `kpis`
- `section_summaries`
- `action_queue_top` (max 5)
- `links` (drill-down routes/endpoints)

```json
{
  "meta": {
    "facility_code": "ACM",
    "window": "today",
    "generated_at": "2026-02-09T14:05:00Z",
    "stale": false,
    "stale_sections": []
  },
  "alerts_top": [
    {
      "id": "alert_1",
      "severity": "critical",
      "title": "Bed occupancy above threshold",
      "started_at": "2026-02-09T12:15:00Z",
      "primary_action": { "label": "Open bed board", "href": "/wards" }
    }
  ],
  "kpis": {
    "occupancy": { "percent": 94.0, "occupied_beds": 94, "total_beds": 100, "trend_pct": 2.5 },
    "admissions_today": { "count": 37, "trend_pct": 4.1 },
    "discharges_today": { "planned": 29, "completed": 18, "completion_rate": 62.1 },
    "appointment_throughput": { "scheduled": 220, "completed": 171, "completion_rate": 77.7 },
    "staffing_coverage": { "required_shifts": 182, "filled_shifts": 169, "critical_uncovered": 3 },
    "compliance_risk": { "break_glass_pending_review": 3, "audit_anomalies_24h": 2, "total": 5 }
  },
  "section_summaries": {
    "capacity": { "status": "warning", "ward_count": 9, "high_occupancy_wards": 3 },
    "workforce": { "status": "warning", "critical_uncovered_count": 3, "next_2h_risks": 5 },
    "compliance": { "status": "normal", "break_glass_pending_review": 3, "audit_anomalies_24h": 2 }
  },
  "action_queue_top": [
    {
      "id": "action_1",
      "severity": "warning",
      "title": "Assign ICU night coverage",
      "href": "/admin/organization/duty-roster"
    }
  ],
  "links": {
    "capacity": "/api/dashboards/admin-v2/capacity/",
    "workforce": "/api/dashboards/admin-v2/workforce/",
    "compliance": "/api/dashboards/admin-v2/compliance/"
  }
}
```

### 7.2 Section detail endpoints

- `GET /api/dashboards/admin-v2/capacity/`
- `GET /api/dashboards/admin-v2/workforce/`
- `GET /api/dashboards/admin-v2/compliance/`

Rules:
- Paged or capped lists only.
- Hard limits: wards <= 20, uncovered shifts <= 20, actions <= 20.
- No endpoint returns unbounded arrays.

## 8. Frontend Component Draft

Page shell:
- `PageShell` + `PageHeader`

Blocks:
- `AdminAlertStrip`
- `AdminKpiGrid`
- `CapacityFlowPanel`
- `WorkforceCoveragePanel`
- `CompliancePanel`
- `ActionQueuePanel`

Shared behavior:
- Every block supports `loading`, `error`, `stale`.
- Start with summary content; fetch detail on expand/open.
- Respect reduced motion and defer heavy charts until expanded.

## 9. State and Refresh Behavior

- Poll fallback: 30s for root summary.
- WebSocket invalidation: invalidate root query; invalidate section query when open.
- Show `Last updated Xs ago`.
- Stale badge at panel header when section freshness lags.

## 10. Efficiency Rules

Payload budgets:
- Root response: <= 12KB gzip target.
- Section detail responses: <= 20KB gzip target.

Query budgets:
- Root summary: O(1) query groups; no per-row loops.
- Section details: paginated/capped lists with explicit ordering.
- No external network I/O in request path.

Caching:
- Root cache key: facility + window.
- Section cache key: facility + window + section + page/filter.
- Use stale-while-refresh and single-flight lock for refresh.

Frontend:
- Avoid rendering large tables by default.
- Virtualize detail lists >100 rows.
- Keep first meaningful paint from root payload only.

## 11. Security and Privacy Rules

- Endpoint requires authenticated admin role + facility scope.
- PHI-free response contract on landing.
- Avoid raw upstream exception text in API payload.
- Cache keys include facility scope.

## 12. Rollout Plan

Phase 1:
- Build `admin-v2` root summary + capacity/workforce/compliance detail endpoints.
- Ship new UI behind feature flag.

Phase 2:
- Add action queue workflows and deeper drill-downs.

Phase 3:
- Add separate technical `System Operations` dashboard.

## 13. Acceptance Criteria

- Admin identifies at least one priority action within 5 seconds.
- No patient identifiers on landing.
- Every alert/KPI has a direct action.
- Root payload meets budget and fast first render.
- WebSocket invalidation refreshes without manual reload.
