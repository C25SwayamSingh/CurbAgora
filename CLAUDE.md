# CLAUDE.md

Project instructions for Claude and compatible AI assistants.

## Context

This is **food-vendor-platform** — a platform for mobile food vendors and customer discovery. Phase 1 is foundation only.

## Key Documents

| Document                 | Purpose                                   |
| ------------------------ | ----------------------------------------- |
| `docs/PRODUCT_SPEC.md`   | Product requirements (add when available) |
| `docs/ARCHITECTURE.md`   | System design and folder structure        |
| `docs/DATA_MODEL.md`     | Planned entities and relationships        |
| `docs/SECURITY_MODEL.md` | Credential and access rules               |
| `docs/USER_FLOWS.md`     | Customer, vendor, and admin flows         |
| `docs/BUILD_PHASES.md`   | Phased delivery plan                      |
| `PROJECT_STATE.md`       | Current implementation status             |
| `AGENTS.md`              | Agent coding guidelines                   |

## Phase 1 Boundaries

Implemented: Next.js scaffold, Tailwind/shadcn, Supabase placeholders, feature folders, landing page, CI, tests.

**Not implemented:** Auth, payments, SMS, maps, loyalty transactions, database schema.

## Coding Standards

- TypeScript strict mode
- App Router conventions (server vs client components)
- Feature modules in `src/features/`
- Mobile-first Tailwind classes
- No secrets in browser bundles

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run format
npm run format:check
```

## When Product Spec Is Added

1. Read `docs/PRODUCT_SPEC.md` completely
2. Update `docs/DATA_MODEL.md`, `docs/USER_FLOWS.md`, and `docs/BUILD_PHASES.md`
3. Do not add features beyond what the spec supports

See `AGENTS.md` for detailed agent guidelines.
