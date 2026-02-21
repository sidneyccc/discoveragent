const { ApiError, getSourceWorkflow, recordApiUsage } = require('../backend/api-core');

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

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

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
    console.warn('Failed to parse SOURCE_REFRESH_SOURCES_JSON for cron refresh. Falling back to defaults.', error);
    return DEFAULT_PERIODIC_SOURCES;
  }
}

function isAuthorized(req) {
  const configured = String(process.env.CRON_SECRET || '').trim();
  if (!configured) return false;
  const authHeader = String(req.headers?.authorization || '').trim();
  return authHeader === `Bearer ${configured}`;
}

module.exports = async function handler(req, res) {
  const endpoint = '/api/cron-source-refresh';
  const startTs = Date.now();
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    recordApiUsage({ endpoint, method: req.method, statusCode: 405, durationMs: Date.now() - startTs });
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!isAuthorized(req)) {
    recordApiUsage({ endpoint, method: req.method, statusCode: 401, durationMs: Date.now() - startTs });
    return res.status(401).json({ error: 'Unauthorized cron request.' });
  }

  const sources = parseRefreshSourcesFromEnv();
  const preferredLanguage = String(process.env.SOURCE_REFRESH_LANG || 'en-US').trim();
  const forceRefresh = String(process.env.SOURCE_REFRESH_FORCE || 'true').trim().toLowerCase() === 'true';

  try {
    const result = await getSourceWorkflow({
      sources,
      preferredLanguage,
      forceRefresh,
    });

    recordApiUsage({
      endpoint,
      method: req.method,
      statusCode: 200,
      durationMs: Date.now() - startTs,
      cacheHit: Boolean(result?.cache?.hit),
      cacheBackend: typeof result?.cache?.backend === 'string' ? result.cache.backend : '',
    });

    return res.status(200).json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      sourceCount: Number(result?.meta?.totalSources || sources.length),
      usableCount: Number(result?.meta?.usableCount || 0),
      failedCount: Number(result?.meta?.failedCount || 0),
      hiddenCount: Number(result?.meta?.hiddenCount || 0),
      cache: result?.cache || {},
    });
  } catch (error) {
    if (error instanceof ApiError) {
      recordApiUsage({ endpoint, method: req.method, statusCode: error.statusCode, durationMs: Date.now() - startTs });
      if (error.statusCode !== 429 && error.details) {
        console.error('Upstream AI error details (cron refresh):', error.details);
      }
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error('Unexpected cron source refresh error:', error);
    recordApiUsage({ endpoint, method: req.method, statusCode: 500, durationMs: Date.now() - startTs });
    return res.status(500).json({
      error: 'Unexpected cron source refresh error.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
