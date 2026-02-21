# DiscoverAgent

DiscoverAgent is an Expo + React Native app (Web + iOS) that generates source-clustered viewpoints for a question and supports voice transcription.

## Stack

- Expo / React Native / Expo Router
- Node.js API (local `backend/server.js`)
- Serverless API routes for deployment (`api/*.js`)
- OpenAI Responses API + Transcriptions API

## Getting Started

### 1) Install

```bash
npm install
```

### 2) Run the app

```bash
npm run web
```

### 3) Run local API server

```bash
npm run api
```

The local API server now runs a background source refresh job by default (startup + every 30 minutes), independent of page loads.

Optional env vars for the background refresh:

- `SOURCE_REFRESH_ENABLED`: set to `false` to disable periodic refresh
- `SOURCE_REFRESH_ON_START`: set to `false` to skip immediate startup refresh
- `SOURCE_REFRESH_INTERVAL_MS`: refresh interval in milliseconds (minimum 60000)
- `SOURCE_REFRESH_FORCE`: set to `true` to bypass cache and force full refresh each run (default: `true`)
- `SOURCE_REFRESH_LANG`: preferred language passed into source workflow (default: `en-US`)
- `SOURCE_REFRESH_SOURCES_JSON`: JSON array of `{ "name": "...", "url": "..." }` to override default source list

### 3.1) Production periodic refresh (Vercel)

For serverless deployment, periodic refresh is handled by Vercel Cron (not `setInterval`):

- Scheduled route: `/api/cron-source-refresh`
- Schedule (Hobby/free): once daily (`0 1 * * *`) in `vercel.json`
- Auth: set `CRON_SECRET` in Vercel environment variables

Vercel Cron includes `Authorization: Bearer <CRON_SECRET>` automatically.  
The refresh endpoint validates this token before running.

If you upgrade to Vercel Pro, you can switch back to a higher-frequency schedule (for example every 30 minutes).

### 3.2) Production periodic refresh every 30 minutes on free plan (GitHub Actions)

This repo includes `.github/workflows/cron-source-refresh.yml` to trigger refresh every 30 minutes.

Set these GitHub repository secrets:

- `CRON_SECRET` (must match Vercel `CRON_SECRET`)
- `CRON_ENDPOINT` (optional, defaults to `https://discoveragent.vercel.app/api/cron-source-refresh`)

You can also trigger it manually from GitHub Actions using `workflow_dispatch`.

### 4) Optional: enable global Redis cache

The source workflow endpoint supports cross-instance cache via Redis REST (recommended for deployed environments with multiple server instances).

Add these env vars:

- `REDIS_REST_URL`: Redis REST endpoint (for example, Upstash REST URL)
- `REDIS_REST_TOKEN`: bearer token for the REST endpoint
- `REDIS_KEY_PREFIX`: optional key namespace (default: `sidagent`)

If Redis is not configured, the API automatically falls back to in-memory cache.
For persistent dashboard analytics across deployments/restarts, configure Redis (`REDIS_REST_URL` + `REDIS_REST_TOKEN`).

## Product and Design Docs

- Product Brief: `/docs/PRODUCT_BRIEF.md`
- Technical Design: `/docs/TECHNICAL_DESIGN.md`

## Build and Deploy

### Local testing (recommended)

Run the app with live reload in one terminal:

```bash
npm run web
```

Run the local API in a second terminal:

```bash
npm run api
```

Then open `http://localhost:8081`.

### Restart whole app locally

From the project root, stop existing local listeners and relaunch both services:

```bash
for p in 3001 8081; do lsof -tiTCP:$p -sTCP:LISTEN -n -P | xargs -r kill; done
npm run api
```

In a second terminal:

```bash
npm run web
```

### Build static web output

```bash
npm run build:web
```

Output is generated in `/dist`.

### Deploy to Vercel (Frontend + API)

This repo is configured for a single Vercel project that serves:

- frontend static web output from `/dist`
- serverless API routes from `/api/*.js`

`vercel.json` defines:
- `buildCommand`: `npm run build:web`
- `outputDirectory`: `dist`
- cron schedule for `/api/cron-source-refresh` once daily on Hobby/free

Recommended env vars in Vercel:
- `OPENAI_API_KEY`
- `CRON_SECRET`
- `REDIS_REST_URL` and `REDIS_REST_TOKEN` (optional)
- `SOURCE_REFRESH_*` values as needed (optional)
- `EXPO_PUBLIC_API_BASE_URL` can be left unset to use same-origin `/api` calls.

## Project Structure

```text
app/
  _layout.tsx         Root navigator and hamburger menu
  index.tsx           Main question + source clustering page
  dashboard.tsx       Usage metrics dashboard page
  transcript.tsx      Placeholder transcript page

api/
  ask.js              Serverless wrapper for Q&A endpoint
  categorize.js       Serverless wrapper for source clustering endpoint
  cron-source-refresh.js Serverless cron handler for periodic source workflow refresh
  metrics.js          Serverless usage metrics endpoint
  source-workflow.js  Serverless wrapper for all-source summarize + cluster flow
  transcribe.js       Serverless wrapper for transcription endpoint

backend/
  api-core.js         Shared API business logic (single source of truth)
  server.js           Local HTTP server using api-core handlers
docs/
  PRODUCT_BRIEF.md    Product goals, use cases, scope, and constraints
  TECHNICAL_DESIGN.md Architecture, flows, caching, and runtime behavior
```

## API Architecture

To keep behavior consistent across local and deployed environments:

- `backend/api-core.js` contains shared logic (validation, rate limiting, OpenAI calls).
- `backend/api-core.js` also tracks API usage metrics in memory for dashboard reporting.
- `backend/server.js` is a thin local HTTP wrapper.
- `api/*.js` are thin serverless wrappers that reuse the same core logic.

This avoids code drift between local and production API behavior.
