# UAT mapping (Section 9)

Automated checks: `npm test` (unit, negative and golden) and `npm run uat -- --base <url>` (browser flows against a running instance). Record the run output, date and environment as UAT evidence.

| Area | Acceptance criterion | How it is verified | Automated |
| --- | --- | --- | --- |
| IAM / credentials | Named users, roles, reset/disable, session controls and admin logging | Wrong-password rejection, role denials (leadership → user admin, viewer → copilot, site user → billing), site scoping, lockout after 5 failures, admin create/disable/reset in `/admin/users`, all audited | `uat.mjs`, `controls.test.ts` (role matrix) |
| OT safety | No command/write path; read-only verified by negative test | Connectors frozen, write-verb methods rejected, no connector write calls anywhere in `src`, no PUT/PATCH/DELETE API handlers, copilot refuses control requests | `controls.test.ts`, `uat.mjs` |
| Data acquisition | Each source reports status, freshness and failure state; stale data is visibly flagged | `/admin/integrations`, `/data-quality`; evidence strips show Degraded/Stale; KHJ-DB-01 stale scenario | `golden.test.ts` (DQ agent) |
| Energy / gas | KPIs and drill-downs reconcile to source data for agreed periods | Deterministic feeds make every view reconcile; recompute a period from the historian export and compare to `/energy` and `/gas` | Manual with approved test periods |
| UAG / opportunity | Explanations show supporting measures and assumptions; indicative until validated | UAG finding lists attribution and assumptions; register shows Indicative until leadership validates; only validated items can be approved | `golden.test.ts`, `uat.mjs` |
| Billing | Exceptions traceable to source records and documents | Each exception carries bill number and document reference; review required before any financial action | `golden.test.ts` |
| Reliability | Health/anomaly state with source timestamp and model version | `/reliability` shows last sample, confidence and `asset-health-model@` version | `golden.test.ts` |
| Alerts | Alerts route to the correct role/site; acknowledgement and closure are logged | Operations acknowledges and closes with action and evidence; audit shows `alert.close` | `uat.mjs` |
| AI copilot | Source-grounded answers with time/site scope and no invented facts | Answers include a Sources line and a "Data used" lineage; site user scope excludes other zones | `golden.test.ts`, `uat.mjs` |
| Security / ops | Logs, monitoring, backup/restore and incident runbooks pass | `/admin/audit`, `/admin/health`, `/api/health`, `npm run backup` (integrity check and manifest), [RUNBOOK.md](RUNBOOK.md) | `uat.mjs` (health, headers), backup script |

## Definition of done (Section 10) status

| Workstream | Exit condition | Status in this build |
| --- | --- | --- |
| Foundation | Production-like environment passes security checklist | Env-driven config, secrets only in env, IAM, audit, security headers. The client's security checklist is still pending. |
| Data integration framework | New site added through configuration + SOP | Master data and connector descriptors are configuration. Real interfaces arrive after the study. |
| Domain dashboards | Role-based views on approved test data | All seven domains, role- and site-scoped |
| AI agents | Golden set passes; evidence and versions retained | 8 agents; golden tests; runs stored with versions and narratives |
| Admin / operations | Operations run without developer database access | Users, integrations, audit, health, DQ queue and agent runs in the UI |
| Security / OT | Negative control tests pass, approvals recorded | `npm run test:readonly`; approvals are audited |
| Documentation | New engineer can follow end to end | README and docs/ |
