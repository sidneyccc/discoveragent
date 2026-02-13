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

### 4) Optional: enable global Redis cache

The source workflow endpoint supports cross-instance cache via Redis REST (recommended for deployed environments with multiple server instances).

Add these env vars:

- `REDIS_REST_URL`: Redis REST endpoint (for example, Upstash REST URL)
- `REDIS_REST_TOKEN`: bearer token for the REST endpoint
- `REDIS_KEY_PREFIX`: optional key namespace (default: `sidagent`)

If Redis is not configured, the API automatically falls back to in-memory cache.

## Build and Deploy

### Build static web output

```bash
npm run build:web
```

Output is generated in `/dist`.

### Deploy to GitHub Pages

- Automatic deploy is configured in `.github/workflows/deploy.yml` on pushes to `main`.
- Manual deploy is also available:

```bash
npm run deploy
```

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
  metrics.js          Serverless usage metrics endpoint
  source-workflow.js  Serverless wrapper for all-source summarize + cluster flow
  transcribe.js       Serverless wrapper for transcription endpoint

backend/
  api-core.js         Shared API business logic (single source of truth)
  server.js           Local HTTP server using api-core handlers
```

## API Architecture

To keep behavior consistent across local and deployed environments:

- `backend/api-core.js` contains shared logic (validation, rate limiting, OpenAI calls).
- `backend/api-core.js` also tracks API usage metrics in memory for dashboard reporting.
- `backend/server.js` is a thin local HTTP wrapper.
- `api/*.js` are thin serverless wrappers that reuse the same core logic.

This avoids code drift between local and production API behavior.
