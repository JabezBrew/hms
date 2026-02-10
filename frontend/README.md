# HMS Frontend

This frontend is a React/Vite application organized by feature modules.

## Primary References

- Documentation hub: /Users/jebre/Desktop/hms/docs/README.md
- Frontend domain index: /Users/jebre/Desktop/hms/docs/domains/frontend/README.md
- Chronicle design system: /Users/jebre/Desktop/hms/frontend/CHRONICLE_DESIGN_SYSTEM.md

## Development

```bash
cd /Users/jebre/Desktop/hms/frontend
npm install
cp .env.example .env
npm run dev
```

## Quality Checks

```bash
cd /Users/jebre/Desktop/hms/frontend
npm run lint
npm run build
```

## Structure

- `src/features/`: domain feature modules (`api`, `hooks`, `components`, `pages`, `routes`).
- `src/app/routes/`: route composition and metadata.
- `src/shared/`: cross-cutting shared utilities and UI primitives.
- `src/pages/`: thin route wrappers only.
