const http = require('http');
const { ApiError, ask, categorize, transcribe, enforceRateLimit, getClientIpFromReq } = require('./api-core');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3001);

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function handleApiRequest(req, res, fn) {
  try {
    const ip = getClientIpFromReq(req);
    enforceRateLimit(ip);

    const body = await readJsonBody(req);
    const payload = await fn(body);
    sendJson(res, 200, payload);
  } catch (error) {
    if (error instanceof ApiError) {
      const headers = error.statusCode === 429 && error.details ? { 'Retry-After': error.details } : {};
      const payload = error.details ? { error: error.message, details: error.details } : { error: error.message };
      sendJson(res, error.statusCode, payload, headers);
      return;
    }

    const pathLabel = req.url || 'unknown route';
    console.error(`Unexpected server error on ${pathLabel}:`, error);
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
    handleApiRequest(req, res, (body) => ask(body.question));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/categorize') {
    handleApiRequest(req, res, (body) =>
      categorize({
        question: body.question,
        answer: body.answer,
        selectedSources: body.selectedSources,
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/api/transcribe') {
    handleApiRequest(req, res, (body) =>
      transcribe({
        audioBase64: body.audioBase64,
        mimeType: body.mimeType,
      })
    );
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`API server running at http://${HOST}:${PORT}`);
});
