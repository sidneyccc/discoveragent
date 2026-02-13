const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

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

function ensureApiKey() {
  if (!OPENAI_API_KEY) {
    throw new ApiError(500, 'AI service is not configured.');
  }
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

  ensureApiKey();
  const responseJson = await postResponsesApi(
    'Answer clearly and concisely. Keep the answer practical. Do not mention underlying model, vendor, or provider.',
    normalizedQuestion
  );

  return { answer: extractAnswer(responseJson) || 'No answer text returned.' };
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

  ensureApiKey();
  const pageText = await fetchPageText(normalizedSourceUrl);

  const userPrompt = `
Source name: ${normalizedSourceName}
Source URL: ${normalizedSourceUrl}
Preferred output language: ${targetLanguage || 'same as user query language'}

Visible page text snapshot:
${pageText}

Task:
1) Summarize the latest important things visible on this source homepage snapshot.
2) Prioritize concrete, recent, high-signal items (major events, announcements, policy changes, market-moving updates).
3) Return 4-8 concise bullets.
4) Add a final bullet called "Limits" noting this is from a homepage snapshot and may miss paywalled/section pages.
5) Do not mention underlying model, vendor, or provider.
6) If preferred language is provided, output in that language.
`.trim();

  const responseJson = await postResponsesApi(
    'You are a precise news summarizer. Summarize only what is supported by the provided text. Avoid speculation.',
    userPrompt
  );

  return {
    summary: extractAnswer(responseJson) || 'No summary returned.',
    sourceName: normalizedSourceName,
    sourceUrl: normalizedSourceUrl,
  };
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
  transcribe,
  enforceRateLimit,
  getClientIpFromReq,
};
