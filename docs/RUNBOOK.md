# Deployment and support runbook

Plain Node.js deployment inside the approved ATGL environment. No containers are required. For a demo or UAT instance hosted outside that environment, see [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md); it cannot reach ATGL internal systems, so it runs on synthetic data.

## Deploy (SOP-01, SOP-09)

1. Provision a Linux VM in the IT zone with Node.js 22.13+. It needs network access only to the historian replica, the ERP/billing, CMMS and GIS read-only endpoints, and `generativelanguage.googleapis.com` if Gemini is approved.
2. Copy the release and install it: `npm ci && npm run verify && npm run build`.
3. Create `.env.local` (or set the variables in the service unit) from `.env.example`:
   - `APP_ENV=production`, `DATA_MODE=live`, `BOOTSTRAP_ADMIN_PASSWORD=<one-time>`
   - `GEMINI_API_KEY` from the approved secret store; `GEMINI_MODEL` pinned to a specific version
   - `AGENT_SCHEDULER_TOKEN` (24+ random characters)
   - `DATABASE_URL`: Neon direct connection string (Console, Connect, Connection pooling off). Tables are created automatically in the private `atgl` schema on first start.
4. Run it under a process manager, for example a systemd unit with `ExecStart=/usr/bin/npm start`, `Restart=always` and `WorkingDirectory=<release>`. Terminate TLS at the approved reverse proxy.
5. Sign in as `admin` with the bootstrap password; you are forced to change it. Create named users and remove the bootstrap password from the environment.
6. Schedule agent runs: `curl -fsS -X POST -H "Authorization: Bearer $AGENT_SCHEDULER_TOKEN" https://<host>/api/agents/run` (hourly, or `?agent=data-quality` every 15 minutes).
7. Point monitoring at `GET /api/health`. It returns 200 with `status: ok|degraded`.

To roll back, keep the previous release directory and backup. Stop the service, switch the symlink to the previous release, restore the matching backup if the schema changed, and start the service.

## Model, prompt and rule release (SOP-05)

1. Change the prompt in `src/lib/ai/prompts.ts` or the rule in `src/lib/analytics/*`, and bump its version string.
2. Run `npm run test:golden`. Any failure blocks the release.
3. Record the approval (who, what, versions) and deploy through staging.
4. Keep the previous `GEMINI_MODEL` value and release for rollback.

## Daily operations (SOP-03, SOP-04, SOP-06)

- **Data quality:** review `/data-quality` daily, assign owners, and record each resolution with its provenance. Never backfill silently.
- **Dashboards:** check the evidence strips. Any "Degraded" or "Stale" figure must be explained before it is used in a decision.
- **Alerts:** each alert is routed to a role. Acknowledge it, act, then close it with the action taken and its evidence.
- **Opportunity register:** owners progress status. Leadership validates values and approves.

## Backup and restore (SOP-08)

- **Neon (production):** point-in-time restore is built in (retention depends on the plan), and a branch gives an instant copy for restore tests. For an off-platform copy, run `pg_dump "$DATABASE_URL" --schema=atgl --format=custom` nightly and store it in the approved location.
- **SQLite (staging/offline):** run `npm run backup` from cron at least daily. It writes `backups/atgl-<timestamp>.db`, verifies integrity, and appends to `backups/manifest.jsonl`. Copy `backups/` off-host.
- For a quarterly restore test, restore onto a staging database (Neon: create a branch at the restore point, or `pg_restore --clean --if-exists --no-owner`; SQLite: `npm run backup -- --restore backups/<file>.db` with the service stopped), start the app, sign in and check the counts. Record the duration as RTO evidence in the manifest. Proposed targets (to agree with ATGL): RPO 24 h, RTO 4 h.

## Security incident (SOP-07)

1. Disable the suspect users in `/admin/users`; disabling also revokes their sessions.
2. Rotate `AGENT_SCHEDULER_TOKEN`, `GEMINI_API_KEY` and the affected connector service account.
3. Preserve evidence: copy `audit_log` (`npm run backup`) and the server logs before any change.
4. Notify the security owner. Isolate the affected connector by removing its network path or credentials.
5. Restore from the approved baseline if integrity is in doubt.

## New site or client (SOP-10)

Add sites, assets and meters to master data (a configuration change through SOP-09), register the connector profile (SOP-02), assign users and role scope, check dashboards and alerts on test data, run UAT (`docs/UAT.md`), and record sign-off.
