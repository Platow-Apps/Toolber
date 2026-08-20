# Toolber

Neighborhood tool-lending PWA — borrow and lend tools with people nearby, every borrow owner-approved, pickup location revealed only after approval.

Start here:
- [`CLAUDE.md`](CLAUDE.md) — orientation for working on this codebase
- [`docs/technical-design.md`](docs/technical-design.md) — entities, API, flows, security
- [`docs/architecture.md`](docs/architecture.md) — system diagram, decision log
- [`docs/feature-checklist.md`](docs/feature-checklist.md) — living scope tracker
- [`docs/audit-2026-08-20.md`](docs/audit-2026-08-20.md) — open code-audit findings

## Quick start

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in your Supabase/Mapbox values first — see `CLAUDE.md` for the full setup.

## Tests

```bash
npm run test:all   # lint, types, unused code, SAST, audit, 183 unit/component tests
supabase test db   # pgTAP RLS tests (needs Docker + `supabase start`)
```

`CLAUDE.md` § Testing explains each gate and how the Supabase client is stubbed.
