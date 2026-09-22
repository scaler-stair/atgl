# ATGL Energy and Gas Intelligence

Read-only intelligence layer for Adani Total Gas (ATGL), built by STAIR Digital from the *AI Energy & Gas Intelligence Production Readiness Blueprint* (v1.0, 21 Sept 2026).

It covers energy, gas balance and UAG, metering and revenue assurance, asset reliability, billing assurance, vendor/AMC, and safety and integrity. It adds an opportunity register, alerts, reports, eight AI agents and a Gemini-powered Executive Copilot. Everything sits behind named-user IAM, site scoping and a full audit trail.

> **Operating principle:** observe, analyse, optimise, never control. There is no write or command path to SCADA, RTUs or station equipment, and the test suite proves it (`npm run test:readonly`).

## Quick start

Requirements: Node.js 22.13 or newer. No Docker. The workflow database is **Neon (PostgreSQL)** when `DATABASE_URL` is set, otherwise a local SQLite file (handy for offline development and tests).

```bash
npm install
cp .env.example .env.local
# edit .env.local:
#   DEMO_USER_PASSWORD="<choose a password>"   # staging demo accounts
#   GEMINI_API_KEY=<your key>                   # enables conversational copilot + agent narratives
#   DATABASE_URL=<Neon direct connection URI>   # optional; empty = local SQLite
#   AGENT_SCHEDULER_TOKEN=<random 24+ chars>    # for the scheduler endpoint
npm run dev            # http://localhost:3100
```

Sign in with any demo account below, using `DEMO_USER_PASSWORD`. Accounts are only seeded outside production.

| Username | Role | Scope |
| --- | --- | --- |
| `admin` | Platform admin | Tenant, users, integrations, health (no business approvals) |
| `leadership` | ATGL leadership | All zones; validates and approves opportunities |
| `operations` | Operations | Ahmedabad and Vadodara sites only |
| `engineering` | Engineering / reliability | All zones; can run agents |
| `finance` | Finance / billing | All zones; billing and metering |
| `security` | IT/OT security | Integrations, audit log, health |
| `siteuser` | Site user | Two Faridabad sites |
| `viewer` | Read-only viewer | Dashboards and reports, no actions |

Without `GEMINI_API_KEY` the copilot uses a deterministic grounded responder. It calls the same tools and cites the same evidence, but its answers are templated.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3100 |
| `npm run build` then `npm start` | Production build and server (port 3100) |
| `npm test` | Negative controls, RBAC invariants and golden cases for agents and copilot |
| `npm run test:readonly` | OT read-only negative control only |
| `npm run test:golden` | SOP-05 golden set (run before any model, prompt or rule release) |
| `npm run test:postgres` | Golden set against an in-process PostgreSQL (PGlite), proving the Postgres (Neon) code path |
| `npm run verify` | Type-check, lint and tests |
| `npm run uat -- --base http://localhost:3100` | Browser UAT flows against a running instance (needs `DEMO_USER_PASSWORD`) |
| `npm run smoke -- --user leadership --pages /,/energy` | Screenshots and console-error check per page |
| `npm run backup` | SQLite: online backup, restore verification and manifest (SOP-08). Neon: prints the pg_dump/restore commands |

## Where things are

```
src/lib/domain        canonical master data (zones, sites, assets, meters, segments, contracts)
src/lib/connectors    read-only connector framework + synthetic feeds (SCADA, historian, RTU, ERP, billing, CMMS, GIS)
src/lib/analytics     versioned calculations; every result carries an Evidence block
src/lib/agents        the 8 agents from Section 4 (deterministic, versioned)
src/lib/ai            Gemini client, versioned prompts, copilot tools and grounding
src/lib/server        SQLite, sessions/IAM, audit, workflow (alerts, opportunities, DQ), agent runner
src/app/(app)         dashboards, workflow pages, governance and admin
src/app/api           copilot, scheduler (agents/run), health
tests/                negative controls and golden cases
scripts/              smoke, UAT, backup/restore
docs/                 architecture, data dictionary, UAT mapping, runbook
```

Read next: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md), [docs/UAT.md](docs/UAT.md), [docs/RUNBOOK.md](docs/RUNBOOK.md) (production deployment inside ATGL), [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md) (demo and UAT hosting).

## What is synthetic

Until the 30 to 60 day ATGL site study confirms interfaces, tag lists and polling rates, every feed comes from `src/lib/connectors/synthetic.ts`. The data is deterministic, so all screens reconcile with each other, and it contains deliberate scenarios for the agents to find (listed in the data dictionary). Every screen and report carries an environment and data-mode marker. Rupee values stay **indicative** until leadership validates them.
