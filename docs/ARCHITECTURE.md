# Architecture

This maps the blueprint's Section 2 layers to the code.

```
SCADA/historian  RTU/OT  ERP/billing  Maintenance  GIS/safety
        \           |         |            |          /
         Secure read-only acquisition (src/lib/connectors)          <- OT/IT segregation, service accounts
                              |
     Normalised data + rules + physics (src/lib/analytics, domain)   <- versioned CALC rules, Evidence on every figure
                              |
           AI agents (src/lib/agents) + Copilot (src/lib/ai)         <- deterministic findings; LLM narrates only
                              |
   Workflow state (Neon Postgres / SQLite): alerts, opportunities, DQ queue, runs   <- src/lib/server
                              |
    Role-based app (src/app): dashboards, alerts, register, reports
                              |
   IAM + audit + monitoring + backup/restore + change control
```

## Layer by layer

| Blueprint layer | Implementation |
| --- | --- |
| Secure acquisition | `defineConnector()` only accepts `get/list/query/read/fetch/describe` methods, rejects write or command verbs, and freezes the connector. Each connector declares its owner, protocol, network path, read-only service account, expected freshness and poll interval. |
| Network boundary | Deployment concern: the app consumes the historian replica or data-diode mirror on the IT side and never reaches the OT network directly. Connector descriptors record the approved path. |
| Data foundation | `src/lib/domain/master.ts` holds canonical IDs (`ZONE-TYPE-NN`, `SITE-CMP-n`, `SITE-FM-1`, `ZONE-SEG-ST-01`). Time series keep their data-quality flags (`gap`, `stale`). |
| Domain intelligence | `src/lib/analytics/*` holds SEC benchmarking, gas balance and UAG attribution, meter drift, asset health (ISO 10816 zones), billing reconciliation, vendor SLA and CP criterion (−0.85 V CSE). Each rule has a version in `CALC`. |
| Application | Next.js 16 App Router. Server components read analytics directly; mutations are server actions guarded by `requireAction()`. |
| Governance | `audit_log` (actor, timestamp, target, before/after, correlation ID), sessions, lockout, `/admin/*` pages, backup script, golden tests. |

## Evidence and lineage

Every KPI, agent finding and copilot tool result carries an `Evidence` object with these fields:

- `window`: the time window of the figure
- `sources`: the source systems
- `quality`: `good`, `degraded`, `stale` or `missing`, derived from real acquisition lag
- `asOf`: the oldest last-good sample
- `version`: the calculation or model version
- `scopeLabel` and `notes`: the scope, plus notes such as excluded stale sites and UAG assumptions

The UI renders it as the evidence strip under each panel. Stale data is shown, never hidden.

## Agents and the LLM

The agents in `src/lib/agents/definitions.ts` are deterministic, versioned pipelines. Their findings are upserted by dedupe key into `alerts`, `opportunities` and `dq_issues`, so a re-run refreshes evidence without duplicating rows. Validated opportunity values are never overwritten.

Gemini is used in exactly two places:

1. **Narratives** (`narrative@x.y.z` prompt): a briefing restricted to the facts in the agent's JSON output. A narrative failure never fails a run.
2. **Executive Copilot** (`copilot@x.y.z` prompt): function calling over 12 read-only tools (`src/lib/ai/tools.ts`), executed inside the caller's site scope. A regex policy guard refuses imperative control requests before the model is called. Every exchange is logged with its tool calls, model, prompt version, grounding flag, latency and correlation ID.

The model is configured through `GEMINI_MODEL`. Pin a specific model version for production releases (SOP-05).

## Identity and access

- Named users only, with passwords hashed using scrypt (N=16384). Sessions use random 256-bit tokens; only their SHA-256 hash is stored.
- Sessions expire after 10 hours absolute or 60 minutes idle. Five failed logins lock the account for 15 minutes, and every attempt is audited.
- The role matrix lives in `src/lib/auth/rbac.ts` (`canView` for modules, `can` for actions). Pages call `requireModule()`; actions call `requireAction()`, and denials are audited.
- Site scoping is applied at the analytics layer (`Scope.allowedSiteIds`), in the workflow queries and in copilot tools.
- Service credentials are separate from human credentials: the scheduler uses `AGENT_SCHEDULER_TOKEN`, and connectors use named read-only service accounts.

## Moving to production infrastructure

- **Database:** `src/lib/server/db.ts` exposes one async API (`all`, `get`, `run`, `tx`) with two drivers. With `DATABASE_URL` set it uses PostgreSQL (Neon) through a `pg` pool; otherwise a local SQLite file. On Postgres, all tables live in a private `atgl` schema with row-level security enabled and no policies, so a hosted data API (Neon Data API, if ever enabled) cannot read them; the app connects as the table owner. Migrations run at startup under an advisory lock. Use Neon's **direct** connection string, not the `-pooler` one: the app sets `search_path` per connection, which PgBouncer transaction pooling does not keep. The app already pools connections itself, and it refuses a pooled URL with a clear error. TLS certificates are verified for `*.neon.tech`.
- **Connectors:** implement each `read` method against the approved interface (historian REST, OData, GIS feature service) and keep the method names. The read-only tests keep passing unchanged.
- **Scheduling:** call `POST /api/agents/run` from the platform scheduler (for example every 15 minutes for data quality and hourly for the rest).
