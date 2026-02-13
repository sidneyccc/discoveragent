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
  transcribe,
  enforceRateLimit,
  getClientIpFromReq,
};
