# Skill Registry

**Orchestrator use only.** Read this registry once per session to resolve skill paths, then pass pre-resolved paths directly to each sub-agent's launch prompt. Sub-agents receive the path and load the skill directly — they do NOT read this registry.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | `C:\Users\Alcatraz\.claude\skills\skill-creator\SKILL.md` |
| When writing Go tests, using teatest, or adding test coverage | go-testing | `C:\Users\Alcatraz\.claude\skills\go-testing\SKILL.md` |

No project-level skills detected (no `.claude/skills/`, `.gemini/skills/`, `.agent/skills/`, or `skills/` directory in this repo).

## Project Conventions

- **No project-level CLAUDE.md / AGENTS.md / .cursorrules / GEMINI.md / copilot-instructions.md** found in the repo root. Only the user's global `~/.claude/CLAUDE.md` applies to this project.
- **No `openspec/` directory** — SDD persistence for this project uses Engram exclusively (topic keys under `sdd/{change-name}/...` and `sdd-init/El-Rey-De-Las-Medialunas`).
- **Monorepo**: pnpm workspaces (`apps/*`, `packages/*`, `workers/*`) + Turborepo. pnpm@9.15.4, Node >=20.
- **Apps** (React/Vite/TS): `apps/pos-pc`, `apps/pos-tablet`, `apps/print-bridge`.
- **Workers** (Cloudflare Workers + Hono + D1): `workers/api` (main, entrypoint `workers/api/src/index.ts`), `workers/inventory-worker`, `workers/reports-worker`, `workers/sync-worker`, `workers/admin-users`.
- **Shared packages**: `packages/shared` (constants: permissions.ts, roles.ts, payment-methods.ts, units.ts), `packages/db-client`, `packages/api-client`, `packages/sync-engine`, `packages/ui`.
- **DB**: Cloudflare D1, migrations at root `migrations/0001..0020_*.sql`, applied via `pnpm db:migrate:local` / `db:migrate:prod` (wraps `wrangler d1 migrations apply el-rey-db`).
- **Testing**: Vitest 4, root config `test/vitest.config.ts`, tests in `test/unit`. Run via `pnpm test` (turbo).
- **Lint/format**: ESLint 8 + eslint-plugin-import + eslint-plugin-react-hooks, Prettier 3. `pnpm lint`, `pnpm format`.
- **CI**: `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml`.
- **Architecture pattern**: generic "requests" system (`workers/api/src/routes/requests.ts`, migrations 0015/0016/0019) backs features like waste/merma requests. Offline-first: local queue (Dexie) synced to D1 via `workers/sync-worker`. Batches/lotes use D1 optimistic concurrency (`data_version` column, migration 0020).
- **Noise warning**: repo contains multiple `.claude/worktrees/agent-*/` directories (leftover isolated sub-agent worktrees) that duplicate the whole repo tree — exclude these from broad globs/greps when searching for source files.

Full detected context: see Engram topic_key `sdd-init/El-Rey-De-Las-Medialunas`.
