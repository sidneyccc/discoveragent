const crypto = require('node:crypto');
const fs = require('node:fs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const REDIS_REST_URL = String(process.env.REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const REDIS_REST_TOKEN = String(process.env.REDIS_REST_TOKEN || '').trim();
const REDIS_KEY_PREFIX = String(process.env.REDIS_KEY_PREFIX || 'sidagent').trim() || 'sidagent';
let PROMPT_SIGNATURE = 'nosig';
try {
  PROMPT_SIGNATURE = crypto.createHash('sha256').update(fs.readFileSync(__filename, 'utf8')).digest('hex').slice(0, 16);
} catch {
  PROMPT_SIGNATURE = 'nosig';
}
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const SOURCE_SUMMARY_CACHE_TTL_MS = 10 * 60 * 1000;
const SOURCE_WORKFLOW_CACHE_TTL_MS = 7 * 60 * 60 * 1000;
const SOURCE_WORKFLOW_CACHE_TTL_SEC = Math.floor(SOURCE_WORKFLOW_CACHE_TTL_MS / 1000);
const ASK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ASK_CACHE_TTL_SEC = Math.floor(ASK_CACHE_TTL_MS / 1000);
const METRICS_RECENT_REQUEST_LIMIT = 120;
const METRICS_RECENT_REFRESH_LIMIT = 120;

const TRUSTED_SOURCES = [
  'Reuters',
  'AP News',
  'BBC',
  'NPR',
  'Weibo',
  'CNN',
  '网易',
  'CCTV',
  'Hacker News',
  'Reddit',
  'Stack Overflow',
  'Wikipedia',
];

const CATEGORIZATION_SYSTEM_PROMPT = `
You are an analyst that groups viewpoints by source quality and source identity.
Use this trusted source priority order first when possible:
1) Reuters
2) AP News
3) BBC
4) NPR
5) Weibo
6) CNN
7) 网易
8) CCTV
9) Hacker News
10) Reddit
11) Stack Overflow
12) Wikipedia

Instructions:
- Categorize the response into source-based opinion buckets.
- Cluster by trusted-source alignment: group trusted sources that express similar opinions into one cluster.
- Consolidate similar opinions into a single paragraph per cluster rather than repeating per source.
- Prefer the prioritized trusted sources above when relevant.
- If information is not available from the trusted list, you may include additional sources, but mark them clearly as "Additional source (not in prioritized list)".
- Do not invent direct quotes or fake citations.
- Match the response language to the original question language.
- Keep output concise and structured with headings.
- Use clear paragraph breaks. Do not return one long line.
- Keep total output at or below 500 words.
- Do not mention underlying model, vendor, or provider.
- End with a short "Coverage Notes" section calling out where evidence is weak or inferred.
`.trim();

const requestLogByIp = new Map();
const sourceSummaryCache = new Map();
const sourceWorkflowCache = new Map();
const sourceWorkflowInFlight = new Map();
const askCache = new Map();
const askInFlight = new Map();
const usageMetrics = {
  startedAt: Date.now(),
  totalRequests: 0,
  successRequests: 0,
  errorRequests: 0,
  totalLatencyMs: 0,
  endpointStats: new Map(),
  recentRequests: [],
  refreshStats: {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    totalDurationMs: 0,
    lastRunAt: '',
    lastStatus: '',
  },
  recentRefreshRuns: [],
};

class ApiError extends Error {
  constructor(statusCode, message, details = '') {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function extractAnswer(responseJson) {
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  if (Array.isArray(responseJson.output)) {
    for (const item of responseJson.output) {
      if (!Array.isArray(item.content)) continue;
      for (const contentItem of item.content) {
        if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
          const text = contentItem.text.trim();
          if (text) return text;
        }
      }
    }
  }

  return '';
}

function getAudioFileExtension(mimeType) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function getClientIpFromReq(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return String(forwardedFor[0]).split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const history = requestLogByIp.get(ip) || [];
  const recent = history.filter((ts) => ts > windowStart);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLogByIp.set(ip, recent);
    const retryAfterSec = Math.max(1, Math.ceil((recent[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  recent.push(now);
  requestLogByIp.set(ip, recent);
  return { allowed: true, retryAfterSec: 0 };
}

function enforceRateLimit(ip) {
  const result = checkRateLimit(ip);
  if (!result.allowed) {
    throw new ApiError(429, 'Rate limit exceeded. Maximum 10 requests per minute per IP.', String(result.retryAfterSec));
  }
}

function getRedisMetricsTotalsKey() {
  return `${REDIS_KEY_PREFIX}:metrics:totals`;
}

function getRedisMetricsEndpointSetKey() {
  return `${REDIS_KEY_PREFIX}:metrics:endpoints`;
}

function getRedisMetricsEndpointKey(endpointId) {
  return `${REDIS_KEY_PREFIX}:metrics:endpoint:${endpointId}`;
}

function getRedisMetricsRecentRequestsKey() {
  return `${REDIS_KEY_PREFIX}:metrics:recent-requests`;
}

function getRedisRefreshSummaryKey() {
  return `${REDIS_KEY_PREFIX}:metrics:refresh:summary`;
}

function getRedisRefreshRecentKey() {
  return `${REDIS_KEY_PREFIX}:metrics:refresh:recent`;
}

function toRedisEndpointId(endpoint, method) {
  return crypto.createHash('sha1').update(`${method}|${endpoint}`).digest('hex');
}

function parseRedisHash(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out = {};
    for (let i = 0; i < raw.length; i += 2) {
      const key = raw[i];
      const value = raw[i + 1];
      if (typeof key === 'string') out[key] = value;
    }
    return out;
  }
  if (typeof raw === 'object') return raw;
  return {};
}

function parseNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

async function persistApiUsageToRedis({ endpointKey, methodLabel, status, latency, nowIso, cacheHit, cacheBackend }) {
  if (!isRedisEnabled()) return;
  const endpointId = toRedisEndpointId(endpointKey, methodLabel);
  const totalsKey = getRedisMetricsTotalsKey();
  const endpointSetKey = getRedisMetricsEndpointSetKey();
  const endpointRedisKey = getRedisMetricsEndpointKey(endpointId);
  const recentRequestsKey = getRedisMetricsRecentRequestsKey();

  try {
    await redisCommand(['HSETNX', totalsKey, 'startedAt', nowIso]);
    await redisCommand(['HINCRBY', totalsKey, 'totalRequests', '1']);
    await redisCommand(['HINCRBY', totalsKey, 'totalLatencyMs', String(latency)]);
    if (status >= 200 && status < 400) {
      await redisCommand(['HINCRBY', totalsKey, 'successRequests', '1']);
    } else {
      await redisCommand(['HINCRBY', totalsKey, 'errorRequests', '1']);
    }

    await redisCommand(['SADD', endpointSetKey, endpointId]);
    await redisCommand([
      'HSET',
      endpointRedisKey,
      'endpoint',
      endpointKey,
      'method',
      methodLabel,
      'lastSeenAt',
      nowIso,
    ]);
    await redisCommand(['HINCRBY', endpointRedisKey, 'total', '1']);
    await redisCommand(['HINCRBY', endpointRedisKey, 'totalLatencyMs', String(latency)]);

    if (status >= 200 && status < 300) await redisCommand(['HINCRBY', endpointRedisKey, 'status2xx', '1']);
    if (status >= 400 && status < 500) await redisCommand(['HINCRBY', endpointRedisKey, 'status4xx', '1']);
    if (status >= 500) await redisCommand(['HINCRBY', endpointRedisKey, 'status5xx', '1']);
    if (status === 429) await redisCommand(['HINCRBY', endpointRedisKey, 'rateLimited', '1']);
    if (status >= 200 && status < 400) await redisCommand(['HINCRBY', endpointRedisKey, 'success', '1']);
    if (status >= 400) await redisCommand(['HINCRBY', endpointRedisKey, 'errors', '1']);
    if (typeof cacheHit === 'boolean') {
      await redisCommand(['HINCRBY', endpointRedisKey, cacheHit ? 'cacheHits' : 'cacheMisses', '1']);
    }

    const recentPayload = JSON.stringify({
      ts: nowIso,
      endpoint: endpointKey,
      method: methodLabel,
      statusCode: status,
      durationMs: latency,
      cacheHit: typeof cacheHit === 'boolean' ? cacheHit : null,
      cacheBackend: typeof cacheBackend === 'string' && cacheBackend ? cacheBackend : '',
    });
    await redisCommand(['RPUSH', recentRequestsKey, recentPayload]);
    await redisCommand(['LTRIM', recentRequestsKey, String(-METRICS_RECENT_REQUEST_LIMIT), '-1']);
  } catch (error) {
    console.warn('Redis metrics write failed, continuing with in-memory metrics:', error instanceof Error ? error.message : String(error));
  }
}

async function persistRefreshUsageToRedis(refreshEntry) {
  if (!isRedisEnabled()) return;
  const summaryKey = getRedisRefreshSummaryKey();
  const recentKey = getRedisRefreshRecentKey();
  try {
    await redisCommand(['HSETNX', summaryKey, 'startedAt', refreshEntry.ts]);
    await redisCommand(['HINCRBY', summaryKey, 'totalRuns', '1']);
    await redisCommand(['HINCRBY', summaryKey, refreshEntry.status === 'success' ? 'successRuns' : 'failedRuns', '1']);
    await redisCommand(['HINCRBY', summaryKey, 'totalDurationMs', String(refreshEntry.durationMs)]);
    await redisCommand(['HSET', summaryKey, 'lastRunAt', refreshEntry.ts, 'lastStatus', refreshEntry.status]);
    await redisCommand(['RPUSH', recentKey, JSON.stringify(refreshEntry)]);
    await redisCommand(['LTRIM', recentKey, String(-METRICS_RECENT_REFRESH_LIMIT), '-1']);
  } catch (error) {
    console.warn('Redis refresh metrics write failed, continuing with in-memory metrics:', error instanceof Error ? error.message : String(error));
  }
}

function recordApiUsage({ endpoint, method = 'POST', statusCode, durationMs = 0, cacheHit, cacheBackend }) {
  const endpointKey = String(endpoint || 'unknown').trim() || 'unknown';
  const methodLabel = String(method || 'POST').trim().toUpperCase() || 'POST';
  const status = Number(statusCode || 0);
  const latency = Math.max(0, Number(durationMs || 0));
  const nowIso = new Date().toISOString();
  const endpointMetricMapKey = `${methodLabel} ${endpointKey}`;

  usageMetrics.totalRequests += 1;
  usageMetrics.totalLatencyMs += latency;
  if (status >= 200 && status < 400) {
    usageMetrics.successRequests += 1;
  } else {
    usageMetrics.errorRequests += 1;
  }

  const endpointCurrent = usageMetrics.endpointStats.get(endpointMetricMapKey) || {
    endpoint: endpointKey,
    method: methodLabel,
    total: 0,
    success: 0,
    errors: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0,
    rateLimited: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalLatencyMs: 0,
    lastSeenAt: '',
  };

  endpointCurrent.total += 1;
  endpointCurrent.totalLatencyMs += latency;
  endpointCurrent.lastSeenAt = nowIso;

  if (status >= 200 && status < 300) endpointCurrent.status2xx += 1;
  if (status >= 400 && status < 500) endpointCurrent.status4xx += 1;
  if (status >= 500) endpointCurrent.status5xx += 1;
  if (status === 429) endpointCurrent.rateLimited += 1;
  if (status >= 200 && status < 400) endpointCurrent.success += 1;
  if (status >= 400) endpointCurrent.errors += 1;
  if (typeof cacheHit === 'boolean') {
    if (cacheHit) endpointCurrent.cacheHits += 1;
    else endpointCurrent.cacheMisses += 1;
  }

  usageMetrics.endpointStats.set(endpointMetricMapKey, endpointCurrent);

  usageMetrics.recentRequests.push({
    ts: nowIso,
    endpoint: endpointKey,
    method: methodLabel,
    statusCode: status,
    durationMs: latency,
    cacheHit: typeof cacheHit === 'boolean' ? cacheHit : null,
    cacheBackend: typeof cacheBackend === 'string' && cacheBackend ? cacheBackend : '',
  });
  if (usageMetrics.recentRequests.length > METRICS_RECENT_REQUEST_LIMIT) {
    usageMetrics.recentRequests.splice(0, usageMetrics.recentRequests.length - METRICS_RECENT_REQUEST_LIMIT);
  }

  void persistApiUsageToRedis({
    endpointKey,
    methodLabel,
    status,
    latency,
    nowIso,
    cacheHit,
    cacheBackend,
  });
}

function recordSourceRefreshRun({
  trigger = 'workflow',
  status = 'success',
  sourceCount = 0,
  usableCount = 0,
  failedCount = 0,
  hiddenCount = 0,
  durationMs = 0,
  cacheHit = null,
  cacheBackend = '',
  error = '',
}) {
  const ts = new Date().toISOString();
  const entry = {
    ts,
    trigger: String(trigger || 'workflow'),
    status: String(status || 'success'),
    sourceCount: Math.max(0, Number(sourceCount || 0)),
    usableCount: Math.max(0, Number(usableCount || 0)),
    failedCount: Math.max(0, Number(failedCount || 0)),
    hiddenCount: Math.max(0, Number(hiddenCount || 0)),
    durationMs: Math.max(0, Number(durationMs || 0)),
    cacheHit: typeof cacheHit === 'boolean' ? cacheHit : null,
    cacheBackend: typeof cacheBackend === 'string' ? cacheBackend : '',
    error: typeof error === 'string' ? error : '',
  };

  usageMetrics.refreshStats.totalRuns += 1;
  usageMetrics.refreshStats.totalDurationMs += entry.durationMs;
  if (entry.status === 'success') usageMetrics.refreshStats.successRuns += 1;
  else usageMetrics.refreshStats.failedRuns += 1;
  usageMetrics.refreshStats.lastRunAt = entry.ts;
  usageMetrics.refreshStats.lastStatus = entry.status;

  usageMetrics.recentRefreshRuns.push(entry);
  if (usageMetrics.recentRefreshRuns.length > METRICS_RECENT_REFRESH_LIMIT) {
    usageMetrics.recentRefreshRuns.splice(0, usageMetrics.recentRefreshRuns.length - METRICS_RECENT_REFRESH_LIMIT);
  }

  void persistRefreshUsageToRedis(entry);
}

function getUsageMetricsSnapshotFromMemory() {
  const total = usageMetrics.totalRequests;
  const successRate = total ? usageMetrics.successRequests / total : 0;
  const avgLatencyMs = total ? usageMetrics.totalLatencyMs / total : 0;
  const now = Date.now();
  const refreshAvgDurationMs = usageMetrics.refreshStats.totalRuns
    ? usageMetrics.refreshStats.totalDurationMs / usageMetrics.refreshStats.totalRuns
    : 0;

  const endpoints = Array.from(usageMetrics.endpointStats.values())
    .map((entry) => ({
      ...entry,
      avgLatencyMs: entry.total ? entry.totalLatencyMs / entry.total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    generatedAt: new Date(now).toISOString(),
    startedAt: new Date(usageMetrics.startedAt).toISOString(),
    uptimeSec: Math.max(0, Math.floor((now - usageMetrics.startedAt) / 1000)),
    totals: {
      requests: total,
      successRequests: usageMetrics.successRequests,
      errorRequests: usageMetrics.errorRequests,
      successRate,
      avgLatencyMs,
    },
    endpoints,
    recentRequests: usageMetrics.recentRequests.slice(-30).reverse(),
    refresh: {
      totalRuns: usageMetrics.refreshStats.totalRuns,
      successRuns: usageMetrics.refreshStats.successRuns,
      failedRuns: usageMetrics.refreshStats.failedRuns,
      avgDurationMs: refreshAvgDurationMs,
      lastRunAt: usageMetrics.refreshStats.lastRunAt,
      lastStatus: usageMetrics.refreshStats.lastStatus || 'unknown',
      recentRuns: usageMetrics.recentRefreshRuns.slice(-20).reverse(),
    },
  };
}

async function getUsageMetricsSnapshotFromRedis() {
  if (!isRedisEnabled()) return null;
  try {
    const totalsHash = parseRedisHash(await redisCommand(['HGETALL', getRedisMetricsTotalsKey()]));
    const startedAtRaw = typeof totalsHash.startedAt === 'string' ? totalsHash.startedAt : '';
    if (!startedAtRaw) return null;

    const endpointIdsRaw = await redisCommand(['SMEMBERS', getRedisMetricsEndpointSetKey()]);
    const endpointIds = Array.isArray(endpointIdsRaw)
      ? endpointIdsRaw.filter((id) => typeof id === 'string' && id)
      : [];

    const endpointHashes = await Promise.all(
      endpointIds.map((endpointId) => redisCommand(['HGETALL', getRedisMetricsEndpointKey(endpointId)]))
    );
    const endpoints = endpointHashes
      .map((raw) => parseRedisHash(raw))
      .map((entry) => {
        const total = parseNumber(entry.total, 0);
        const totalLatencyMs = parseNumber(entry.totalLatencyMs, 0);
        return {
          endpoint: String(entry.endpoint || 'unknown'),
          method: String(entry.method || 'POST').toUpperCase(),
          total,
          success: parseNumber(entry.success, 0),
          errors: parseNumber(entry.errors, 0),
          status2xx: parseNumber(entry.status2xx, 0),
          status4xx: parseNumber(entry.status4xx, 0),
          status5xx: parseNumber(entry.status5xx, 0),
          rateLimited: parseNumber(entry.rateLimited, 0),
          cacheHits: parseNumber(entry.cacheHits, 0),
          cacheMisses: parseNumber(entry.cacheMisses, 0),
          totalLatencyMs,
          avgLatencyMs: total ? totalLatencyMs / total : 0,
          lastSeenAt: String(entry.lastSeenAt || ''),
        };
      })
      .sort((a, b) => b.total - a.total);

    const recentRequestsRaw = await redisCommand(['LRANGE', getRedisMetricsRecentRequestsKey(), '-30', '-1']);
    const recentRequests = (Array.isArray(recentRequestsRaw) ? recentRequestsRaw : [])
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter((item) => item && typeof item === 'object')
      .reverse();

    const refreshSummaryHash = parseRedisHash(await redisCommand(['HGETALL', getRedisRefreshSummaryKey()]));
    const refreshTotalRuns = parseNumber(refreshSummaryHash.totalRuns, 0);
    const refreshAvgDurationMs = refreshTotalRuns
      ? parseNumber(refreshSummaryHash.totalDurationMs, 0) / refreshTotalRuns
      : 0;
    const refreshRecentRaw = await redisCommand(['LRANGE', getRedisRefreshRecentKey(), '-20', '-1']);
    const refreshRecentRuns = (Array.isArray(refreshRecentRaw) ? refreshRecentRaw : [])
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter((item) => item && typeof item === 'object')
      .reverse();

    const startedAtMs = Date.parse(startedAtRaw);
    const now = Date.now();
    const totalRequests = parseNumber(totalsHash.totalRequests, 0);
    const successRequests = parseNumber(totalsHash.successRequests, 0);
    const errorRequests = parseNumber(totalsHash.errorRequests, 0);
    const totalLatencyMs = parseNumber(totalsHash.totalLatencyMs, 0);

    return {
      generatedAt: new Date(now).toISOString(),
      startedAt: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : new Date(now).toISOString(),
      uptimeSec: Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((now - startedAtMs) / 1000)) : 0,
      totals: {
        requests: totalRequests,
        successRequests,
        errorRequests,
        successRate: totalRequests ? successRequests / totalRequests : 0,
        avgLatencyMs: totalRequests ? totalLatencyMs / totalRequests : 0,
      },
      endpoints,
      recentRequests,
      refresh: {
        totalRuns: refreshTotalRuns,
        successRuns: parseNumber(refreshSummaryHash.successRuns, 0),
        failedRuns: parseNumber(refreshSummaryHash.failedRuns, 0),
        avgDurationMs: refreshAvgDurationMs,
        lastRunAt: String(refreshSummaryHash.lastRunAt || ''),
        lastStatus: String(refreshSummaryHash.lastStatus || 'unknown'),
        recentRuns: refreshRecentRuns,
      },
    };
  } catch (error) {
    console.warn('Redis metrics read failed, falling back to in-memory metrics:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function getUsageMetricsSnapshot() {
  const redisSnapshot = await getUsageMetricsSnapshotFromRedis();
  if (redisSnapshot) return redisSnapshot;
  return getUsageMetricsSnapshotFromMemory();
}

function ensureApiKey() {
  if (!OPENAI_API_KEY) {
    throw new ApiError(500, 'AI service is not configured.');
  }
}

function getSourceSummaryCacheKey({ sourceName, sourceUrl, preferredLanguage }) {
  return `${PROMPT_SIGNATURE}|${String(sourceName || '').trim().toLowerCase()}|${String(sourceUrl || '').trim()}|${String(preferredLanguage || '').trim().toLowerCase()}`;
}

function normalizePreferredLanguage(preferredLanguage) {
  const normalized = String(preferredLanguage || '').trim();
  if (!normalized) return '';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized) ? normalized : '';
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPageText(url) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    throw new ApiError(400, 'Source URL is required.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new ApiError(400, 'Invalid source URL.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ApiError(400, 'Only HTTP/HTTPS URLs are supported.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SidAgent/1.0; +https://example.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError(502, 'Failed to fetch source page.');
    }

    const html = await response.text();
    const text = stripHtmlToText(html);
    if (!text) {
      throw new ApiError(502, 'Source page had no readable content.');
    }

    // Keep context bounded for latency/cost.
    return text.slice(0, 16000);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'Failed to fetch source page.');
  } finally {
    clearTimeout(timeout);
  }
}

async function postResponsesApi(systemPrompt, userPrompt) {
  const apiRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!apiRes.ok) {
    const details = await apiRes.text();
    throw new ApiError(502, 'AI service request failed.', details);
  }

  return apiRes.json();
}

async function ask(question) {
  const normalizedQuestion = String(question || '').trim();
  if (!normalizedQuestion) {
    throw new ApiError(400, 'Question is required.');
  }

  const key = getAskCacheKey(normalizedQuestion);
  const now = Date.now();
  const redisCached = await getAskFromRedis(key);
  if (redisCached && now - redisCached.ts < ASK_CACHE_TTL_MS) {
    return {
      ...redisCached.value,
      cache: {
        hit: true,
        stale: false,
        ttlMs: ASK_CACHE_TTL_MS,
        ageMs: now - redisCached.ts,
        backend: 'redis',
      },
    };
  }

  const cached = askCache.get(key);
  if (cached && now - cached.ts < ASK_CACHE_TTL_MS) {
    return {
      ...cached.value,
      cache: {
        hit: true,
        stale: false,
        ttlMs: ASK_CACHE_TTL_MS,
        ageMs: now - cached.ts,
        backend: 'memory',
      },
    };
  }

  if (askInFlight.has(key)) {
    const value = await askInFlight.get(key);
    const current = askCache.get(key);
    return {
      ...value,
      cache: {
        hit: !!current,
        stale: false,
        ttlMs: ASK_CACHE_TTL_MS,
        ageMs: current ? now - current.ts : 0,
        backend: 'memory',
      },
    };
  }

  const promise = (async () => {
    ensureApiKey();
    const responseJson = await postResponsesApi(
      'Answer clearly and concisely. Keep the answer practical. Do not mention underlying model, vendor, or provider.',
      normalizedQuestion
    );
    const value = { answer: extractAnswer(responseJson) || 'No answer text returned.' };
    askCache.set(key, { ts: Date.now(), value });
    await setAskInRedis(key, value);
    return value;
  })().finally(() => {
    askInFlight.delete(key);
  });

  askInFlight.set(key, promise);
  const value = await promise;
  return {
    ...value,
    cache: {
      hit: Boolean(cached || redisCached),
      stale: false,
      ttlMs: ASK_CACHE_TTL_MS,
      ageMs: 0,
      backend: isRedisEnabled() ? 'redis+memory' : 'memory',
    },
  };
}

async function categorize({ question, answer, selectedSources }) {
  const normalizedQuestion = String(question || '').trim();
  const normalizedAnswer = String(answer || '').trim();

  if (!normalizedQuestion) {
    throw new ApiError(400, 'Question is required.');
  }

  ensureApiKey();

  const selectedSourcesInput = Array.isArray(selectedSources)
    ? selectedSources.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
    : [];
  const effectiveSources = selectedSourcesInput.length ? selectedSourcesInput : TRUSTED_SOURCES;

  const answerSection = normalizedAnswer
    ? `Current answer to categorize:\n${normalizedAnswer}`
    : 'No pre-generated answer was provided. Build the categorized summary directly from the question.';

  const userPrompt = `
Original question:
${normalizedQuestion}

${answerSection}

Selected prioritized sources:
${effectiveSources.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}

Please return:
1) "### Clustered Source Views" with 2-4 clusters.
2) For each cluster use this exact shape:
   - "#### Cluster N: <theme>"
   - "Sources: <comma-separated sources>"
   - One short paragraph with the consolidated shared opinion for those sources.
3) Do not create one subsection per source when sources are saying the same thing.
4) "### Additional source (not in prioritized list)" only if needed.
5) "### Consensus / Disagreement Summary" with 3-6 bullets.
6) "### Coverage Notes" with uncertainty/gaps.
7) Insert a blank line between every section and between clusters.
8) Keep the full response to 500 words maximum.
9) Use the same language as the original question.
`.trim();

  const responseJson = await postResponsesApi(CATEGORIZATION_SYSTEM_PROMPT, userPrompt);
  return { categorized: extractAnswer(responseJson) || 'No categorized output returned.' };
}

async function summarizeSource({ sourceName, sourceUrl, preferredLanguage }) {
  const normalizedSourceName = String(sourceName || '').trim() || 'Source';
  const normalizedSourceUrl = String(sourceUrl || '').trim();
  const targetLanguage = normalizePreferredLanguage(preferredLanguage);
  const cacheKey = getSourceSummaryCacheKey({
    sourceName: normalizedSourceName,
    sourceUrl: normalizedSourceUrl,
    preferredLanguage: targetLanguage,
  });
  const now = Date.now();
  const cached = sourceSummaryCache.get(cacheKey);
  if (cached && now - cached.ts < SOURCE_SUMMARY_CACHE_TTL_MS) {
    return cached.value;
  }

  ensureApiKey();
  const pageText = await fetchPageText(normalizedSourceUrl);

  const userPrompt = `
Source name: ${normalizedSourceName}
Source URL: ${normalizedSourceUrl}
Preferred output language: ${targetLanguage || 'same as user query language'}

Visible page text snapshot:
${pageText}

Task:
1) First validate quality: if this snapshot is mostly an error/login/paywall/captcha/access-denied/maintenance page, respond exactly:
   UNUSABLE_SOURCE: <short reason>
2) Otherwise summarize the latest important things visible on this source homepage snapshot.
3) Prioritize concrete, recent, high-signal items (major events, announcements, policy changes, market-moving updates).
4) Return 4-8 concise bullets.
5) Add a final bullet called "Limits" noting this is from a homepage snapshot and may miss paywalled/section pages.
6) Do not mention underlying model, vendor, or provider.
7) If preferred language is provided, output in that language.
8) Remove nonsensical fragments, malformed snippets, navigation noise, and duplicated points.
`.trim();

  const responseJson = await postResponsesApi(
    'You are a precise news summarizer. Summarize only what is supported by the provided text. Avoid speculation.',
    userPrompt
  );

  const rawSummary = extractAnswer(responseJson) || 'No summary returned.';
  const unusableMatch = rawSummary.match(/^UNUSABLE_SOURCE:\s*(.+)$/i);
  const result = {
    summary: unusableMatch ? '' : rawSummary,
    sourceName: normalizedSourceName,
    sourceUrl: normalizedSourceUrl,
    isDisplayable: !unusableMatch,
    unusableReason: unusableMatch ? unusableMatch[1].trim() : '',
  };
  sourceSummaryCache.set(cacheKey, { ts: now, value: result });
  return result;
}

async function summarizeAndClusterSources({ sources, preferredLanguage }) {
  if (!Array.isArray(sources) || !sources.length) {
    throw new ApiError(400, 'At least one source is required.');
  }

  ensureApiKey();
  const targetLanguage = normalizePreferredLanguage(preferredLanguage);

  const limitedSources = sources
    .filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string')
    .slice(0, 20);

  if (!limitedSources.length) {
    throw new ApiError(400, 'No valid sources provided.');
  }

  const fetched = await Promise.allSettled(
    limitedSources.map(async (source) => {
      const sourceName = String(source.name).trim();
      const sourceUrl = String(source.url).trim();
      const text = await fetchPageText(sourceUrl);
      return { sourceName, sourceUrl, text };
    })
  );

  const successful = fetched
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  const failed = fetched
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => r.status === 'rejected')
    .map(({ idx }) => `${limitedSources[idx].name} (${limitedSources[idx].url})`);

  if (!successful.length) {
    throw new ApiError(502, 'Failed to fetch source pages.');
  }

  const snapshots = successful
    .map(
      (s, idx) =>
        `### Source ${idx + 1}: ${s.sourceName}\nURL: ${s.sourceUrl}\nSnapshot:\n${s.text.slice(0, 4000)}`
    )
    .join('\n\n');

  const userPrompt = `
Preferred output language: ${targetLanguage || 'same as user language'}

You are given homepage snapshots from multiple sources. Summarize and cluster the latest important topics.

Requirements:
1) Output a ranked list of clustered items, ordered by coverage breadth (most sources mentioning the topic first).
2) Cap the list to 20 items maximum.
3) For each item include:
   - Title
   - Sources: comma-separated source names
   - Source count: N
   - 2-4 bullet points summarizing the key developments
4) If a source disagrees materially with others, mention that in the item.
5) Exclude trivial/low-signal topics.
6) If preferred language is provided, output in that language.
7) Do not mention underlying model, vendor, or provider.

Source snapshots:
${snapshots}
`.trim();

  const responseJson = await postResponsesApi(
    'You are a senior news editor. Cluster overlapping stories and rank by cross-source mention count.',
    userPrompt
  );

  return {
    clustered: extractAnswer(responseJson) || 'No clustered output returned.',
    sourceCount: successful.length,
    failedSources: failed,
  };
}

async function categorizeSourceSummaries({ sourceSummaries, preferredLanguage }) {
  if (!Array.isArray(sourceSummaries) || !sourceSummaries.length) {
    throw new ApiError(400, 'At least one source summary is required.');
  }

  ensureApiKey();
  const targetLanguage = normalizePreferredLanguage(preferredLanguage);

  const normalized = sourceSummaries
    .filter((s) => s && typeof s.name === 'string' && typeof s.summary === 'string')
    .map((s) => ({
      name: String(s.name).trim(),
      url: typeof s.url === 'string' ? String(s.url).trim() : '',
      summary: String(s.summary).trim(),
    }))
    .filter((s) => s.name && s.summary)
    .slice(0, 40);

  if (!normalized.length) {
    throw new ApiError(400, 'No valid source summaries provided.');
  }

  const payload = normalized
    .map(
      (s, idx) =>
        `### Source ${idx + 1}: ${s.name}\nURL: ${s.url || 'N/A'}\nSummary:\n${s.summary.slice(0, 3000)}`
    )
    .join('\n\n');

  const userPrompt = `
Preferred output language: ${targetLanguage || 'same as user language'}

You are given per-source summaries. Cluster and prioritize the shared stories.

Requirements:
1) Rank clustered items by coverage breadth (most sources mentioning first).
2) Cap to 20 items maximum.
3) For each item include:
   - Title
   - Sources: comma-separated source names
   - Source count: N
   - 2-4 concise bullet points
4) Mention meaningful disagreement where present.
5) Keep high-signal topics only.
6) If preferred language is provided, output in that language.
7) Do not mention underlying model, vendor, or provider.
8) Remove items that are unclear, incoherent, or nonsensical.

Per-source summaries:
${payload}
`.trim();

  const responseJson = await postResponsesApi(
    'You are a senior news editor. Cluster overlapping stories and rank by cross-source mention count.',
    userPrompt
  );

  return {
    clustered: extractAnswer(responseJson) || 'No clustered output returned.',
    sourceCount: normalized.length,
  };
}

function getSourceWorkflowCacheKey({ sources, preferredLanguage }) {
  const normalizedSources = (Array.isArray(sources) ? sources : [])
    .filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string')
    .map((s) => `${String(s.name).trim()}|${String(s.url).trim()}`)
    .sort()
    .join('||');
  const lang = normalizePreferredLanguage(preferredLanguage);
  return `${PROMPT_SIGNATURE}|${lang}::${normalizedSources}`;
}

function isRedisEnabled() {
  return Boolean(REDIS_REST_URL && REDIS_REST_TOKEN);
}

function getRedisSourceWorkflowKey(cacheKey) {
  const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
  return `${REDIS_KEY_PREFIX}:source-workflow:${hash}`;
}

function getAskCacheKey(question) {
  return crypto.createHash('sha256').update(`${PROMPT_SIGNATURE}|${String(question || '').trim()}`).digest('hex');
}

function getRedisAskKey(cacheKey) {
  return `${REDIS_KEY_PREFIX}:ask:${cacheKey}`;
}

async function redisCommand(command) {
  const response = await fetch(REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Redis request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'result')) {
    return payload.result;
  }

  return payload;
}

async function getWorkflowFromRedis(cacheKey) {
  if (!isRedisEnabled()) return null;

  const redisKey = getRedisSourceWorkflowKey(cacheKey);
  try {
    const serialized = await redisCommand(['GET', redisKey]);
    if (typeof serialized !== 'string' || !serialized.trim()) return null;
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || !parsed.value || typeof parsed.ts !== 'number') {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Redis read failed, falling back to in-memory cache:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function setWorkflowInRedis(cacheKey, value) {
  if (!isRedisEnabled()) return;
  const redisKey = getRedisSourceWorkflowKey(cacheKey);
  const payload = JSON.stringify({ ts: Date.now(), value });
  try {
    await redisCommand(['SET', redisKey, payload, 'EX', String(SOURCE_WORKFLOW_CACHE_TTL_SEC)]);
  } catch (error) {
    console.warn('Redis write failed, continuing with in-memory cache:', error instanceof Error ? error.message : String(error));
  }
}

async function getAskFromRedis(cacheKey) {
  if (!isRedisEnabled()) return null;
  const redisKey = getRedisAskKey(cacheKey);
  try {
    const serialized = await redisCommand(['GET', redisKey]);
    if (typeof serialized !== 'string' || !serialized.trim()) return null;
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || !parsed.value || typeof parsed.ts !== 'number') {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Redis ask-cache read failed, falling back to in-memory cache:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function setAskInRedis(cacheKey, value) {
  if (!isRedisEnabled()) return;
  const redisKey = getRedisAskKey(cacheKey);
  const payload = JSON.stringify({ ts: Date.now(), value });
  try {
    await redisCommand(['SET', redisKey, payload, 'EX', String(ASK_CACHE_TTL_SEC)]);
  } catch (error) {
    console.warn('Redis ask-cache write failed, continuing with in-memory cache:', error instanceof Error ? error.message : String(error));
  }
}

async function runSourceWorkflow({ sources, preferredLanguage }) {
  const startedAt = Date.now();
  const sourceList = Array.isArray(sources) ? sources : [];
  if (!sourceList.length) {
    throw new ApiError(400, 'At least one source is required.');
  }

  try {
    const sourceSummaries = await Promise.all(
      sourceList.map(async (source) => {
        try {
          const result = await summarizeSource({
            sourceName: source.name,
            sourceUrl: source.url,
            preferredLanguage,
          });

          return {
            name: String(source.name || '').trim(),
            url: String(source.url || '').trim(),
            summary: result.summary || '',
            error: '',
            isDisplayable: result.isDisplayable !== false,
            unusableReason: result.unusableReason || '',
          };
        } catch (error) {
          return {
            name: String(source.name || '').trim(),
            url: String(source.url || '').trim(),
            summary: '',
            error: error instanceof Error ? error.message : 'Failed to summarize source.',
            isDisplayable: false,
            unusableReason: '',
          };
        }
      })
    );

    const usable = sourceSummaries.filter((s) => !s.error && s.summary && s.isDisplayable !== false);
    const failedCount = sourceSummaries.filter((s) => s.error).length;
    const hiddenCount = sourceSummaries.filter((s) => !s.error && s.isDisplayable === false).length;

    let clustered = '';
    if (usable.length) {
      const clusteredRes = await categorizeSourceSummaries({
        sourceSummaries: usable.map((s) => ({ name: s.name, url: s.url, summary: s.summary })),
        preferredLanguage,
      });
      clustered = clusteredRes.clustered || '';
    }

    const result = {
      sourceSummaries,
      clustered,
      meta: {
        totalSources: sourceSummaries.length,
        fetchedCount: sourceSummaries.length - failedCount,
        failedCount,
        hiddenCount,
        usableCount: usable.length,
      },
      generatedAt: new Date().toISOString(),
    };

    recordSourceRefreshRun({
      trigger: 'source-workflow',
      status: 'success',
      sourceCount: result.meta.totalSources,
      usableCount: result.meta.usableCount,
      failedCount: result.meta.failedCount,
      hiddenCount: result.meta.hiddenCount,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    recordSourceRefreshRun({
      trigger: 'source-workflow',
      status: 'failed',
      sourceCount: sourceList.length,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function getSourceWorkflow({ sources, preferredLanguage, forceRefresh = false }) {
  const key = getSourceWorkflowCacheKey({ sources, preferredLanguage });
  const now = Date.now();
  const redisCached = !forceRefresh ? await getWorkflowFromRedis(key) : null;
  if (!forceRefresh && redisCached && now - redisCached.ts < SOURCE_WORKFLOW_CACHE_TTL_MS) {
    return {
      ...redisCached.value,
      cache: {
        hit: true,
        stale: false,
        ttlMs: SOURCE_WORKFLOW_CACHE_TTL_MS,
        ageMs: now - redisCached.ts,
        backend: 'redis',
      },
    };
  }

  const cached = sourceWorkflowCache.get(key);

  if (!forceRefresh && cached && now - cached.ts < SOURCE_WORKFLOW_CACHE_TTL_MS) {
    return {
      ...cached.value,
      cache: {
        hit: true,
        stale: false,
        ttlMs: SOURCE_WORKFLOW_CACHE_TTL_MS,
        ageMs: now - cached.ts,
        backend: 'memory',
      },
    };
  }

  if (sourceWorkflowInFlight.has(key)) {
    const value = await sourceWorkflowInFlight.get(key);
    const current = sourceWorkflowCache.get(key);
    return {
      ...value,
      cache: {
        hit: !!current,
        stale: false,
        ttlMs: SOURCE_WORKFLOW_CACHE_TTL_MS,
        ageMs: current ? now - current.ts : 0,
        backend: 'memory',
      },
    };
  }

  const promise = runSourceWorkflow({ sources, preferredLanguage })
    .then((value) => {
      sourceWorkflowCache.set(key, { ts: Date.now(), value });
      return setWorkflowInRedis(key, value).then(() => value);
    })
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      sourceWorkflowInFlight.delete(key);
    });

  sourceWorkflowInFlight.set(key, promise);
  const value = await promise;
  return {
    ...value,
    cache: {
      hit: Boolean(cached || redisCached),
      stale: false,
      ttlMs: SOURCE_WORKFLOW_CACHE_TTL_MS,
      ageMs: 0,
      backend: isRedisEnabled() ? 'redis+memory' : 'memory',
    },
  };
}

async function transcribe({ audioBase64, mimeType }) {
  const normalizedAudioBase64 = String(audioBase64 || '').trim();
  const normalizedMimeType = String(mimeType || 'audio/webm').trim();

  if (!normalizedAudioBase64) {
    throw new ApiError(400, 'audioBase64 is required.');
  }

  ensureApiKey();

  const audioBuffer = Buffer.from(normalizedAudioBase64, 'base64');
  if (!audioBuffer.length) {
    throw new ApiError(400, 'Decoded audio content is empty.');
  }

  const extension = getAudioFileExtension(normalizedMimeType);
  const blob = new Blob([audioBuffer], { type: normalizedMimeType || 'audio/webm' });
  const formData = new FormData();
  formData.append('file', blob, `recording.${extension}`);
  formData.append('model', OPENAI_TRANSCRIBE_MODEL);

  const apiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!apiRes.ok) {
    const details = await apiRes.text();
    throw new ApiError(502, 'AI transcription request failed.', details);
  }

  const responseJson = await apiRes.json();
  const transcript =
    typeof responseJson?.text === 'string'
      ? responseJson.text.trim()
      : typeof responseJson?.transcript === 'string'
        ? responseJson.transcript.trim()
        : '';

  return { transcript: transcript || '' };
}

module.exports = {
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
};
