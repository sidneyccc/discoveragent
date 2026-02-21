# DiscoverAgent Technical Design

## 1. Architecture Overview
DiscoverAgent uses a shared API core with two runtime wrappers:
- Local long-running Node server: `/backend/server.js`
- Serverless handlers: `/api/*.js`

Business logic is centralized in `/backend/api-core.js` to keep behavior aligned across local and deployed routes.

## 2. Major Components
### Frontend (Expo Router)
- `/app/index.tsx`: question analysis, source highlights, voice input/transcription integration.
- `/app/dashboard.tsx`: usage metrics dashboard.
- `/app/_layout.tsx`: navigation/menu.

### Backend API Core
- `/backend/api-core.js`:
  - Input validation, prompt construction, model calls.
  - Source fetching + summarization + clustering pipeline.
  - Caching and in-flight de-duplication.
  - Rate limiting and usage metrics aggregation.

### HTTP Wrappers
- `/backend/server.js`: local HTTP server + periodic background refresh worker.
- `/api/*.js`: serverless wrappers with CORS, method guards, and error mapping.

## 3. Key Runtime Flows
### A) Categorize question flow
1. Client posts question to `/api/categorize`.
2. `categorize()` builds source-priority-aware prompt.
3. OpenAI Responses API returns categorized output.
4. Result is rendered as structured rich text.

### B) Source workflow flow
1. Client posts source list + language to `/api/source-workflow`.
2. `getSourceWorkflow()` checks:
- Redis cache (if configured)
- In-memory cache
- Existing in-flight promise for same key
3. On miss, `runSourceWorkflow()`:
- Summarizes each source homepage
- Filters unusable sources
- Clusters usable summaries
4. Response returns:
- `sourceSummaries`
- `clustered`
- `meta` counts
- `cache` metadata

### C) Voice transcription fallback flow
1. Browser speech recognition used if available.
2. Else record audio in browser and POST base64 payload to `/api/transcribe`.
3. Backend sends multipart request to OpenAI transcription API.
4. Transcript appended to question input.

### D) Metrics flow
1. Handlers call `recordApiUsage()` per request.
2. Dashboard polls `/api/metrics` every 30 seconds.
3. `getUsageMetricsSnapshot()` returns totals, endpoint stats, and recent requests.

## 4. Caching and Freshness
- Source summary cache TTL: 10 minutes (memory).
- Source workflow cache TTL: 7 hours (memory, optional Redis copy).
- In-flight dedupe: identical workflow requests share one promise.

Background refresh (local server process):
- Configured in `/backend/server.js`.
- Defaults:
  - enabled: `true`
  - run on start: `true`
  - interval: 30 minutes
  - force refresh: `true`
- Overlap protection prevents concurrent refresh runs.

Frontend refresh behavior:
- On app home screen mount: source workflow fetch runs once.
- While page remains open: repeat every 6 hours.
- Manual forced refresh is available via `Discover Latest Highlights`.

## 5. Data and State
- No persistent relational/document database in current implementation.
- In-memory maps store:
  - rate-limit windows by IP
  - summary/workflow caches
  - usage metrics
- Optional Redis REST is used for cross-instance workflow cache sharing.

## 6. API Endpoints (Current)
- `POST /api/ask`
- `POST /api/categorize`
- `POST /api/transcribe`
- `POST /api/source-summary`
- `POST /api/source-categorize`
- `POST /api/source-clusters`
- `POST /api/source-workflow`
- `GET /api/metrics`

All endpoints include method checks, structured JSON errors, and rate-limit enforcement.

## 7. Reliability, Security, and Limits
- Rate limit: 10 req/min/IP.
- Request timeout for source page fetch: 10s.
- URL protocol guard: HTTP/HTTPS only.
- CORS is open (`*`) for current deployment simplicity.
- Error details from upstream AI calls are logged server-side (non-429 paths).

Known limits:
- HTML snapshot extraction may include noise and can miss dynamic/paywalled content.
- Metrics and in-memory cache reset on process restart.
- Serverless-only runtimes do not provide guaranteed long-lived periodic jobs without external scheduling.

## 8. Environment Configuration
Core:
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSCRIBE_MODEL`

Redis cache (optional):
- `REDIS_REST_URL`, `REDIS_REST_TOKEN`, `REDIS_KEY_PREFIX`

Background refresh worker (local server):
- `SOURCE_REFRESH_ENABLED`
- `SOURCE_REFRESH_ON_START`
- `SOURCE_REFRESH_INTERVAL_MS` (minimum 60000)
- `SOURCE_REFRESH_FORCE`
- `SOURCE_REFRESH_LANG`
- `SOURCE_REFRESH_SOURCES_JSON`

Frontend API routing:
- `EXPO_PUBLIC_API_BASE_URL`

## 9. Design Tradeoffs
- Shared core reduces drift between local and serverless behavior.
- In-memory metrics/caching keep implementation simple, but sacrifices durability.
- Periodic local refresh improves freshness for long-running Node deployments, but not for pure serverless without external cron.
