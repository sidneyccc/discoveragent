const { ApiError, getSourceWorkflow, enforceRateLimit, getClientIpFromReq } = require('../backend/api-core');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const ip = getClientIpFromReq(req);
    enforceRateLimit(ip);

    const result = await getSourceWorkflow({
      sources: req.body?.sources,
      preferredLanguage: req.body?.preferredLanguage,
      forceRefresh: Boolean(req.body?.forceRefresh),
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.statusCode === 429 && error.details) {
        res.setHeader('Retry-After', error.details);
      }
      if (error.statusCode !== 429 && error.details) {
        console.error('Upstream AI error details:', error.details);
      }
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error('Unexpected source workflow server error:', error);
    return res.status(500).json({
      error: 'Unexpected source workflow server error.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
