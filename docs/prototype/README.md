# Frozen prototype — historical reference only

This is the original no-build, CDN-based Toolber prototype (pegboard /
hardware-store visual language, in-memory `SEED_TOOLS`). It is **not** part of
the app: nothing in `src/` imports it, it is not built, and it is not deployed.

It used to live at the repo root (`toolber.jsx`) and in `mvp/`, where it was
close enough to the real source to be edited by mistake, and where the linter,
the type checker and the security scanner all kept tripping over it. It is
archived here instead — see `docs/audit-2026-08-20.md` (CQ-4).

- `toolber.jsx` / `app.jsx` — the same single-file prototype, two copies
- `index.html` — CDN dev harness (Babel + Tailwind from unpkg/cdn, no SRI)
- `serve.ps1` — a tiny PowerShell static file server: `pwsh docs/prototype/serve.ps1`

Everything real lives in `src/`. If you want the visual reference, look at the
screen mockups listed in `docs/feature-checklist.md` instead — those are the
actual spec.
