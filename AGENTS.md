# AGENTS.md

Guidance for AI coding agents working on the food-vendor-platform repository.

## Project

Production-ready platform for mobile food vendors (carts, trucks, stands, pop-ups) and customer discovery.

## Before You Code

1. Read `docs/PRODUCT_SPEC.md` if present — do not invent unsupported requirements.
2. Check `PROJECT_STATE.md` for current phase and what is implemented.
3. Review `docs/BUILD_PHASES.md` to stay within the active phase scope.

## Architecture

- **Framework:** Next.js App Router, TypeScript
- **Styling:** Tailwind CSS v4, shadcn/ui (`src/components/ui/`)
- **Features:** Domain modules under `src/features/<domain>/`
- **Backend (future):** Supabase — placeholders in `src/lib/supabase/`

## Rules

### Do

- Keep changes scoped to the requested phase
- Use mobile-first responsive design
- Place domain logic in the appropriate `src/features/` module
- Use `src/lib/supabase/client.ts` for browser code (anon key only)
- Use `src/lib/supabase/server.ts` for server code
- Run `npm run lint`, `npm run typecheck`, and `npm run test` before finishing

### Do Not

- Add payment processing, SMS, Mapbox, or loyalty transaction logic unless explicitly requested for that phase
- Import or expose `SUPABASE_SERVICE_ROLE_KEY` in client-accessible code
- Prefix server secrets with `NEXT_PUBLIC_`
- Invent product features not supported by the product spec
- Commit `.env` files with real secrets

## File Conventions

| Path                        | Purpose                                |
| --------------------------- | -------------------------------------- |
| `src/app/`                  | Next.js routes                         |
| `src/components/ui/`        | shadcn/ui components                   |
| `src/components/marketing/` | Public marketing UI                    |
| `src/features/<domain>/`    | Domain module (README + index.ts)      |
| `src/lib/supabase/`         | Supabase client configuration          |
| `docs/`                     | Architecture and product documentation |
| `e2e/`                      | Playwright tests                       |
| `src/test/`                 | Vitest setup                           |

## Testing

- Unit/component tests: `src/**/*.test.tsx` with Vitest + RTL
- E2E tests: `e2e/*.spec.ts` with Playwright
- CI runs all checks on push/PR to main

## Environment

Copy the appropriate example file:

- Local: `.env.local.example` → `.env.local`
- Staging: `.env.staging.example`
- Production: `.env.production.example`

See `docs/SECURITY_MODEL.md` for credential rules.
