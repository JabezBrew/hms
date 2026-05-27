# React Doctor False Positives

These suppressions are intentionally narrow and should be removed if React
Doctor learns these runtime entry points.

## `deslop/unused-file`

- `public/runtime-config.js` is loaded by `index.html` as `/runtime-config.js`.
  The Docker image also templates this file at container start before nginx
  serves it.
- `public/hms-static-sw.js` is registered by
  `src/lib/service-worker-registration.js` as `/hms-static-sw.js`.

Both files are reached outside the JavaScript import graph, so the dead-code
scanner cannot prove their runtime use. The ignore is limited to these two
files and only to `deslop/unused-file`.
