const { ApiError, summarizeSource, recordApiUsage, enforceRateLimit, getClientIpFromReq } = require('../backend/api-core');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  const endpoint = '/api/source-summary';
  const startTs = Date.now();
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    recordApiUsage({ endpoint, method: req.method, statusCode: 405, durationMs: Date.now() - startTs });
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const ip = getClientIpFromReq(req);
    enforceRateLimit(ip);

    const result = await summarizeSource({
      sourceName: req.body?.sourceName,
      sourceUrl: req.body?.sourceUrl,
      preferredLanguage: req.body?.preferredLanguage,
    });

    recordApiUsage({ endpoint, method: req.method, statusCode: 200, durationMs: Date.now() - startTs });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      recordApiUsage({ endpoint, method: req.method, statusCode: error.statusCode, durationMs: Date.now() - startTs });
      if (error.statusCode === 429 && error.details) {
        res.setHeader('Retry-After', error.details);
      }
      if (error.statusCode !== 429 && error.details) {
        console.error('Upstream AI error details:', error.details);
      }
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error('Unexpected source summary server error:', error);
    recordApiUsage({ endpoint, method: req.method, statusCode: 500, durationMs: Date.now() - startTs });
    return res.status(500).json({
      error: 'Unexpected source summary server error.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
