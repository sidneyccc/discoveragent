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
});
