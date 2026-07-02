# food-vendor-platform

Production-ready platform for mobile food vendors - food carts, food trucks, stands, and pop-up vendors - and the customers who discover them.

## Status — Phase 2: Authentication & Tenancy

Implemented: Supabase authentication (cookie sessions via @supabase/ssr),
email verification, password reset, customer/vendor onboarding, vendor
organizations with role-based memberships (owner/manager/staff), a platform
admin foundation, TOTP MFA, and database-level tenant isolation (RLS
default-deny + versioned migrations). **MFA (TOTP, aal2) is mandatory —
not optional — for organization owners/managers and for platform admins**,
enforced independently in the server guards, the sensitive server actions,
and the database (see [Security Model](docs/SECURITY_MODEL.md)). Session
refresh and coarse route guards run in `src/proxy.ts` (Next.js 16's
`middleware.ts` replacement).

Not yet implemented: discovery/maps, menus, reviews, loyalty, billing, SMS,
member-invitation UI, admin moderation tools.

## Quick Start

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without Supabase
configured, public pages work and all protected routes redirect to sign-in.

### With a local Supabase stack (full auth flows)

Requires a **Docker-compatible container runtime** (Docker Desktop, OrbStack,
Colima, etc. — anything that provides a working `docker` daemon). The
Supabase CLI itself is installed as a local `devDependency` (`npm install`
already fetched it into `node_modules/.bin/supabase`) — the `npm run db:*`
scripts below always use that local binary via `npx`/`node_modules/.bin`,
never a global install.

```bash
npm run db:start                # boots Postgres + Auth, applies migrations
npx supabase status              # prints URL + anon key
# put those values into .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
npm run dev
```

Auth emails (verification, password reset, MFA-adjacent account emails) are
captured locally by the Supabase CLI's **Mailpit** at
http://localhost:54324 — open a message there to get the verification/reset
link instead of a real inbox.

### Database migrations & policy tests

All of these use the locally installed `supabase` CLI (never a global
install) and require the local stack to be running (`npm run db:start`)
except `db:lint`, which only needs a container runtime available.

```bash
npm run db:reset   # re-apply supabase/migrations/ locally (supabase db reset)
npm run db:test    # pgTAP RLS + MFA/AAL policy tests (supabase test db)
npm run db:lint    # static analysis of the schema (supabase db lint)
npm run db:types   # regenerate src/lib/supabase/database.types.ts
npm run db:stop    # stop the local stack
npx supabase db push   # apply migrations to a linked remote project
```

## Scripts

| Command                | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `npm run dev`          | Start development server                               |
| `npm run build`        | Production build                                       |
| `npm run lint`         | ESLint                                                 |
| `npm run typecheck`    | TypeScript check                                       |
| `npm run test`         | Vitest unit tests                                      |
| `npm run test:e2e`     | Playwright E2E tests                                   |
| `npm run format`       | Prettier format                                        |
| `npm run format:check` | Prettier check                                         |
| `npm run db:start`     | Start local Supabase (requires Docker/OrbStack/Colima) |
| `npm run db:stop`      | Stop local Supabase                                    |
| `npm run db:reset`     | Re-apply migrations to the local database              |
| `npm run db:test`      | Run pgTAP policy tests (`supabase/tests/`)             |
| `npm run db:lint`      | Lint the database schema                               |
| `npm run db:types`     | Regenerate `src/lib/supabase/database.types.ts`        |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Data Model](docs/DATA_MODEL.md)
- [Security Model](docs/SECURITY_MODEL.md) — role hierarchy, RLS intent, MFA, authorization test matrix
- [User Flows](docs/USER_FLOWS.md)
- [Build Phases](docs/BUILD_PHASES.md)
- [Project State](PROJECT_STATE.md)
- [Agent Guidelines](AGENTS.md)

## Environment

Copy the appropriate example file for your environment:

- `.env.local.example` → `.env.local` (local development)
- `.env.staging.example` (staging)
- `.env.production.example` (production)

Outside development, the app fails fast at startup if Supabase env vars are
missing — placeholders are never used in staging/production. The
service-role key is not used by the app and must never be exposed to the
browser. See [Security Model](docs/SECURITY_MODEL.md).

## Feature Modules

Domain modules live under `src/features/`:

authentication, customer-discovery, vendors, organizations, menus,
live-locations, loyalty, qr-codes, ambassadors, reviews, billing,
administration
