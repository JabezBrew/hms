# frontend/public

Status: active static assets
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: public static files served with the frontend.

## Contents

- favicons and touch icons
- Chronicle font assets and CSS
- `runtime-config.js`
- `hms-static-sw.js`

## Invariants

- `runtime-config.js` is runtime configuration, not a place for secrets.
- Static service-worker behavior must not cache authorization-sensitive API data.
- Font and icon assets can be public.
