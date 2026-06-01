# referrals feature

Status: active
Owner: Frontend/Referral Workflow
Last reviewed: 2026-06-01
Scope: referral inbox, sent referrals, SLA state, and clinic waitlist actions.

## Routes

- `/referrals/inbox`
- `/referrals/sent`

## Backend Contracts

- `/api/v2/referrals`
- `/api/v2/referrals/:id/*`
- `/api/v2/referrals/clinic-waitlist/*`

## Invariants

- Referral state transitions are backend-authoritative.
- Waitlist promotion creates appointment/offer state through backend contracts.
- Cross-facility exchange/export is not implicitly enabled by referral UI.
