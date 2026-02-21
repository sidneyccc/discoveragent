const http = require('http');
const {
  ApiError,
  ask,
  categorize,
  summarizeSource,
  summarizeAndClusterSources,
  categorizeSourceSummaries,
  getSourceWorkflow,
  transcribe,
  recordApiUsage,
  getUsageMetricsSnapshot,
  enforceRateLimit,
  getClientIpFromReq,
} = require('./api-core');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3001);
const SOURCE_REFRESH_ENABLED = String(process.env.SOURCE_REFRESH_ENABLED || 'true').trim().toLowerCase() !== 'false';
const SOURCE_REFRESH_ON_START = String(process.env.SOURCE_REFRESH_ON_START || 'true').trim().toLowerCase() !== 'false';
const SOURCE_REFRESH_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.SOURCE_REFRESH_INTERVAL_MS || 30 * 60 * 1000)
);
const SOURCE_REFRESH_FORCE = String(process.env.SOURCE_REFRESH_FORCE || 'true').trim().toLowerCase() === 'true';
const SOURCE_REFRESH_LANG = String(process.env.SOURCE_REFRESH_LANG || 'en-US').trim();
const DEFAULT_PERIODIC_SOURCES = [
  { name: 'Reuters', url: 'https://www.reuters.com' },
  { name: 'AP News', url: 'https://apnews.com' },
  { name: 'BBC', url: 'https://www.bbc.com/news' },
  { name: 'NPR', url: 'https://www.npr.org' },
  { name: 'Weibo', url: 'https://weibo.com' },
  { name: 'CNN', url: 'https://www.cnn.com' },
  { name: '网易', url: 'https://www.163.com' },
  { name: 'CCTV', url: 'https://english.cctv.com' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com' },
  { name: 'Reddit', url: 'https://www.reddit.com' },
];

function parseRefreshSourcesFromEnv() {
  const raw = String(process.env.SOURCE_REFRESH_SOURCES_JSON || '').trim();
  if (!raw) return DEFAULT_PERIODIC_SOURCES;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PERIODIC_SOURCES;
    const normalized = parsed
      .filter((entry) => entry && typeof entry.name === 'string' && typeof entry.url === 'string')
      .map((entry) => ({ name: entry.name.trim(), url: entry.url.trim() }))
      .filter((entry) => entry.name && entry.url);
    return normalized.length ? normalized : DEFAULT_PERIODIC_SOURCES;
  } catch (error) {
    console.warn('Failed to parse SOURCE_REFRESH_SOURCES_JSON. Falling back to defaults.', error);
    return DEFAULT_PERIODIC_SOURCES;
  }
}

const SOURCE_REFRESH_SOURCES = parseRefreshSourcesFromEnv();
let refreshTimer = null;
let refreshInProgress = false;

async function runPeriodicSourceRefresh(trigger) {
  if (!SOURCE_REFRESH_ENABLED) return;
  if (refreshInProgress) {
    console.log(`[source-refresh] Skipping ${trigger} run because a refresh is already in progress.`);
    return;
  }

  refreshInProgress = true;
  const startedAt = Date.now();
  try {
    const payload = await getSourceWorkflow({
      sources: SOURCE_REFRESH_SOURCES,
      preferredLanguage: SOURCE_REFRESH_LANG,
      forceRefresh: SOURCE_REFRESH_FORCE,
    });
    const usableCount = Number(payload?.meta?.usableCount || 0);
    const totalSources = Number(payload?.meta?.totalSources || SOURCE_REFRESH_SOURCES.length);
    const cacheBackend = typeof payload?.cache?.backend === 'string' ? payload.cache.backend : 'memory';
    console.log(
      `[source-refresh] ${trigger} run complete in ${Date.now() - startedAt}ms. usable=${usableCount}/${totalSources}, cache=${cacheBackend}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[source-refresh] ${trigger} run failed: ${message}`);
  } finally {
    refreshInProgress = false;
  }
}

function schedulePeriodicSourceRefresh() {
  if (!SOURCE_REFRESH_ENABLED) {
    console.log('[source-refresh] Disabled by SOURCE_REFRESH_ENABLED=false');
    return;
  }

  console.log(
    `[source-refresh] Enabled. intervalMs=${SOURCE_REFRESH_INTERVAL_MS}, onStart=${SOURCE_REFRESH_ON_START}, forceRefresh=${SOURCE_REFRESH_FORCE}, sources=${SOURCE_REFRESH_SOURCES.length}`
  );

  if (SOURCE_REFRESH_ON_START) {
    runPeriodicSourceRefresh('startup');
  }

  refreshTimer = setInterval(() => {
    runPeriodicSourceRefresh('interval');
  }, SOURCE_REFRESH_INTERVAL_MS);
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new ApiError(400, 'Invalid JSON body.'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function handleApiRequest(req, res, endpoint, fn, metricsFromPayload) {
  const startTs = Date.now();
  try {
    const ip = getClientIpFromReq(req);
    enforceRateLimit(ip);

    const body = await readJsonBody(req);
    const payload = await fn(body);
    const usageMeta = typeof metricsFromPayload === 'function' ? metricsFromPayload(payload) : null;
    recordApiUsage({
      endpoint,
      method: req.method,
      statusCode: 200,
      durationMs: Date.now() - startTs,
      cacheHit: usageMeta && typeof usageMeta.cacheHit === 'boolean' ? usageMeta.cacheHit : undefined,
      cacheBackend: usageMeta && typeof usageMeta.cacheBackend === 'string' ? usageMeta.cacheBackend : undefined,
    });
    sendJson(res, 200, payload);
  } catch (error) {
    if (error instanceof ApiError) {
      const headers = error.statusCode === 429 && error.details ? { 'Retry-After': error.details } : {};
      if (error.statusCode !== 429 && error.details) {
        console.error('Upstream AI error details:', error.details);
      }
      recordApiUsage({
        endpoint,
        method: req.method,
        statusCode: error.statusCode,
        durationMs: Date.now() - startTs,
      });
      sendJson(res, error.statusCode, { error: error.message }, headers);
      return;
    }

    const pathLabel = req.url || 'unknown route';
    console.error(`Unexpected server error on ${pathLabel}:`, error);
    recordApiUsage({
      endpoint,
      method: req.method,
      statusCode: 500,
      durationMs: Date.now() - startTs,
    });
    sendJson(res, 500, {
      error: 'Unexpected server error.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    handleApiRequest(req, res, '/api/ask', (body) => ask(body.question));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/categorize') {
    handleApiRequest(req, res, '/api/categorize', (body) =>
      categorize({
        question: body.question,
        answer: body.answer,
        selectedSources: body.selectedSources,
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/api/transcribe') {
    handleApiRequest(req, res, '/api/transcribe', (body) =>
      transcribe({
        audioBase64: body.audioBase64,
        mimeType: body.mimeType,
      })
    );
    return;
  }


  if (req.method === 'POST' && req.url === '/api/source-clusters') {
    handleApiRequest(req, res, '/api/source-clusters', (body) =>
      summarizeAndClusterSources({
        sources: body.sources,
        preferredLanguage: body.preferredLanguage,
      })
    );
    return;
  }
  if (req.method === 'POST' && req.url === '/api/source-summary') {
    handleApiRequest(req, res, '/api/source-summary', (body) =>
      summarizeSource({
        sourceName: body.sourceName,
        sourceUrl: body.sourceUrl,
        preferredLanguage: body.preferredLanguage,
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/api/source-categorize') {
    handleApiRequest(req, res, '/api/source-categorize', (body) =>
      categorizeSourceSummaries({
        sourceSummaries: body.sourceSummaries,
        preferredLanguage: body.preferredLanguage,
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/api/source-workflow') {
    handleApiRequest(
      req,
      res,
      '/api/source-workflow',
      (body) =>
      getSourceWorkflow({
        sources: body.sources,
        preferredLanguage: body.preferredLanguage,
        forceRefresh: Boolean(body.forceRefresh),
      }),
      (payload) => ({
        cacheHit: Boolean(payload?.cache?.hit),
        cacheBackend: typeof payload?.cache?.backend === 'string' ? payload.cache.backend : '',
      })
    );
    return;
  }

  if (req.method === 'GET' && req.url === '/api/metrics') {
    const startTs = Date.now();
    try {
      const ip = getClientIpFromReq(req);
      enforceRateLimit(ip);
      const payload = getUsageMetricsSnapshot();
      recordApiUsage({
        endpoint: '/api/metrics',
        method: req.method,
        statusCode: 200,
        durationMs: Date.now() - startTs,
      });
      sendJson(res, 200, payload);
      return;
    } catch (error) {
      if (error instanceof ApiError) {
        const headers = error.statusCode === 429 && error.details ? { 'Retry-After': error.details } : {};
        recordApiUsage({
          endpoint: '/api/metrics',
          method: req.method,
          statusCode: error.statusCode,
          durationMs: Date.now() - startTs,
        });
        sendJson(res, error.statusCode, { error: error.message }, headers);
        return;
      }

      recordApiUsage({
        endpoint: '/api/metrics',
        method: req.method,
        statusCode: 500,
        durationMs: Date.now() - startTs,
      });
      sendJson(res, 500, {
        error: 'Unexpected metrics server error.',
        details: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`API server running at http://${HOST}:${PORT}`);
  schedulePeriodicSourceRefresh();
});

function shutdown() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
