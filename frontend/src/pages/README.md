# frontend/src/pages

Status: compatibility area
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: legacy page wrapper area and global error/access pages.

## Current Role

Most product page logic now belongs in `frontend/src/features/<domain>/pages`.
This directory should remain thin.

## Active Files

| File | Role |
| --- | --- |
| `FeatureUnavailablePage.jsx` | route shown when a feature is disabled/unavailable. |
| `UnauthorizedPage.jsx` | route shown when access is denied. |

## Empty Compatibility Directories

Several domain-named subdirectories exist locally as old route-wrapper
placeholders. They should remain empty unless a migration explicitly needs a
thin wrapper. Product page logic belongs in `frontend/src/features/<domain>/pages`.

## Invariants

- Do not add product workflow logic here when a feature module exists.
- Access-denied and feature-unavailable pages must not reveal PHI or hidden
  feature details.
