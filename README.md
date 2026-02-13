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
  transcript.tsx      Placeholder transcript page

api/
  ask.js              Serverless wrapper for Q&A endpoint
  categorize.js       Serverless wrapper for source clustering endpoint
  transcribe.js       Serverless wrapper for transcription endpoint

backend/
  api-core.js         Shared API business logic (single source of truth)
  server.js           Local HTTP server using api-core handlers
```

## API Architecture

To keep behavior consistent across local and deployed environments:

- `backend/api-core.js` contains shared logic (validation, rate limiting, OpenAI calls).
- `backend/server.js` is a thin local HTTP wrapper.
- `api/*.js` are thin serverless wrappers that reuse the same core logic.

This avoids code drift between local and production API behavior.
