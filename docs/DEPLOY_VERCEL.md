# Deploying to Vercel

Vercel is a good fit for the **demo and UAT environment** running on synthetic data, and for showing the platform to ATGL. It is not the production target: the blueprint requires the application to sit inside ATGL's approved environment with OT/IT segregation, and a Vercel deployment cannot reach the historian, ERP, CMMS or GIS endpoints on their internal network. For production, follow [RUNBOOK.md](RUNBOOK.md) instead.

## Before you start

- A Neon database (or any managed PostgreSQL). Vercel has no writable disk, so the SQLite fallback cannot be used; the app fails fast with a clear message if `DATABASE_URL` is missing.
- A Gemini API key.
- The repository pushed to GitHub, GitLab or Bitbucket, or the Vercel CLI installed.

## 1. Choose the database connection

| Option | Connection string | `DATABASE_SCHEMA` | When to use |
| --- | --- | --- | --- |
| Direct | host **without** `-pooler` | `atgl` (default) | Low traffic. Tables stay in a private schema that a hosted data API cannot read. |
| Pooled | host **with** `-pooler` | `public` | Higher traffic or many concurrent serverless instances. PgBouncer cannot pass the schema setting through, so the tables live in `public`. |

Set `DATABASE_POOL_SIZE=3` on Vercel either way: each serverless instance keeps its own pool, and many small pools are better than a few large ones.

## 2. Create the project

With the CLI, from the project directory:

```bash
npx vercel link      # creates the project
npx vercel env pull  # optional: check what is set
npx vercel --prod    # deploy
```

Or import the repository in the Vercel dashboard. The framework is detected automatically; leave the build and output settings at their defaults.

## 3. Environment variables

Add these under **Project settings, Environment variables** (Production, and Preview if you use it):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string (see step 1) |
| `DATABASE_SCHEMA` | `atgl` for direct, `public` for pooled |
| `DATABASE_POOL_SIZE` | `3` |
| `GEMINI_API_KEY` | your key |
| `GEMINI_MODEL` | `gemini-3.5-flash` |
| `GEMINI_FALLBACK_MODELS` | `gemini-flash-lite-latest` |
| `APP_ENV` | `staging` for a demo, `production` for a real tenant |
| `DATA_MODE` | `synthetic` until real feeds are connected |
| `DEMO_USER_PASSWORD` | strong password; seeds the 8 demo accounts (staging only) |
| `BOOTSTRAP_ADMIN_PASSWORD` | required instead when `APP_ENV=production` |
| `AGENT_SCHEDULER_TOKEN` | 24+ random characters |
| `CRON_SECRET` | set by Vercel when you add crons; the agent endpoint accepts it |
| `SESSION_TTL_HOURS`, `SESSION_IDLE_MINUTES` | optional overrides (10 and 60) |

Never commit these. `.env.local` stays local.

## 4. Region and latency

`vercel.json` pins the functions to `iad1` (Washington DC), which is close to Neon's `us-east-2`. Keep the function region and the database region on the same continent, otherwise every query crosses an ocean and pages slow to a second or more. If you move the Neon project to `ap-south-1` (Mumbai) for users in India, change `regions` to `["bom1"]`.

## 5. Scheduled agent runs

`vercel.json` includes two cron jobs, both daily because the Hobby plan rejects anything more frequent:

- `/api/agents/run` (all agents) at 01:00 UTC, which is 06:30 IST
- `/api/agents/run?agent=data-quality` at 13:00 UTC, which is 18:30 IST

Schedules are always in UTC. On the Pro plan, change them to the operating cadence you want, for example `0 * * * *` (hourly) for data quality and `30 */6 * * *` for the full set.

Vercel sends a GET with `Authorization: Bearer $CRON_SECRET`, which the endpoint accepts alongside `AGENT_SCHEDULER_TOKEN`. To run the agents at any time:

```bash
curl -X POST -H "Authorization: Bearer $AGENT_SCHEDULER_TOKEN" https://<your-app>.vercel.app/api/agents/run
```

## 6. First run

On the first request the app creates its tables, seeds the users and runs all agents once, which can take longer than a single function invocation allows. Either run the curl command above right after deploying, or simply reload the page if the first load times out. Once the tables hold data, normal pages are unaffected.

## Limits to know

- **Function duration** is capped at 60 seconds (`maxDuration` on the copilot and agent routes). A Gemini answer takes 15 to 50 seconds; past its budget the copilot falls back to its deterministic grounded answers.
- **Rate limiting** for the copilot is per instance, so the effective limit is higher than 12 questions per minute across several instances. Move it to the database if that matters.
- **Backups** are Neon's responsibility here; `npm run backup` only covers the local SQLite file.
- **The browser scripts** (`smoke`, `uat`, `screenshots`) are development tools and are not deployed.

## After deploying

1. Open `/api/health`: it must return `ok` or `degraded` with `database.ok: true`.
2. Sign in and check `/admin/health`: it should show "PostgreSQL (Neon)" and the agent run times.
3. Run the UAT flows against the deployment: `DEMO_USER_PASSWORD=... npm run uat -- --base https://<your-app>.vercel.app`.
4. For a private demo, protect the deployment with Vercel Authentication (Project settings, Deployment protection) so only your team can reach it.
