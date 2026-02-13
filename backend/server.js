const http = require('http');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3001);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestLogByIp = new Map();
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
- End with a short "Coverage Notes" section calling out where evidence is weak or inferred.
`.trim();

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

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return String(forwardedFor[0]).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
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

async function handleAsk(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    let parsedBody;
    try {
      parsedBody = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body.' });
      return;
    }

    const question = String(parsedBody.question || '').trim();
    if (!question) {
      sendJson(res, 400, { error: 'Question is required.' });
      return;
    }

    if (!OPENAI_API_KEY) {
      sendJson(res, 500, { error: 'OPENAI_API_KEY is not set on the server.' });
      return;
    }

    try {
      const apiRes = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: [
            {
              role: 'system',
              content: 'Answer clearly and concisely. Keep the answer practical.',
            },
            {
              role: 'user',
              content: question,
            },
          ],
        }),
      });

      if (!apiRes.ok) {
        const details = await apiRes.text();
        console.error('OpenAI request failed:', apiRes.status, details);
        sendJson(res, 502, { error: 'OpenAI request failed.', details });
        return;
      }

      const responseJson = await apiRes.json();
      const answer = extractAnswer(responseJson);

      sendJson(res, 200, {
        answer: answer || 'No answer text returned.',
      });
    } catch (error) {
      console.error('Unexpected server error:', error);
      sendJson(res, 500, {
        error: 'Unexpected server error.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function handleCategorize(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    let parsedBody;
    try {
      parsedBody = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body.' });
      return;
    }

    const question = String(parsedBody.question || '').trim();
    const answer = String(parsedBody.answer || '').trim();
    const selectedSourcesInput = Array.isArray(parsedBody.selectedSources)
      ? parsedBody.selectedSources.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
      : [];
    const selectedSources = selectedSourcesInput.length ? selectedSourcesInput : TRUSTED_SOURCES;

    if (!question) {
      sendJson(res, 400, { error: 'Question is required.' });
      return;
    }

    if (!OPENAI_API_KEY) {
      sendJson(res, 500, { error: 'OPENAI_API_KEY is not set on the server.' });
      return;
    }

    const answerSection = answer
      ? `Current answer to categorize:\n${answer}`
      : 'No pre-generated answer was provided. Build the categorized summary directly from the question.';

    const userPrompt = `
Original question:
${question}

${answerSection}

Selected prioritized sources:
${selectedSources.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}

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

    try {
      const apiRes = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: [
            {
              role: 'system',
              content: CATEGORIZATION_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        }),
      });

      if (!apiRes.ok) {
        const details = await apiRes.text();
        console.error('OpenAI categorization request failed:', apiRes.status, details);
        sendJson(res, 502, { error: 'OpenAI categorization request failed.', details });
        return;
      }

      const responseJson = await apiRes.json();
      const categorized = extractAnswer(responseJson);

      sendJson(res, 200, {
        categorized: categorized || 'No categorized output returned.',
      });
    } catch (error) {
      console.error('Unexpected categorization server error:', error);
      sendJson(res, 500, {
        error: 'Unexpected categorization server error.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function handleTranscribe(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    let parsedBody;
    try {
      parsedBody = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body.' });
      return;
    }

    const audioBase64 = String(parsedBody.audioBase64 || '').trim();
    const mimeType = String(parsedBody.mimeType || 'audio/webm').trim();

    if (!audioBase64) {
      sendJson(res, 400, { error: 'audioBase64 is required.' });
      return;
    }

    if (!OPENAI_API_KEY) {
      sendJson(res, 500, { error: 'OPENAI_API_KEY is not set on the server.' });
      return;
    }

    try {
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      if (!audioBuffer.length) {
        sendJson(res, 400, { error: 'Decoded audio content is empty.' });
        return;
      }

      const extension = getAudioFileExtension(mimeType);
      const blob = new Blob([audioBuffer], { type: mimeType || 'audio/webm' });
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
        console.error('OpenAI transcription request failed:', apiRes.status, details);
        sendJson(res, 502, { error: 'OpenAI transcription request failed.', details });
        return;
      }

      const responseJson = await apiRes.json();
      const transcript =
        typeof responseJson?.text === 'string'
          ? responseJson.text.trim()
          : typeof responseJson?.transcript === 'string'
            ? responseJson.transcript.trim()
            : '';

      sendJson(res, 200, {
        transcript: transcript || '',
      });
    } catch (error) {
      console.error('Unexpected transcription server error:', error);
      sendJson(res, 500, {
        error: 'Unexpected transcription server error.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    const ip = getClientIp(req);
    const limitResult = checkRateLimit(ip);
    if (!limitResult.allowed) {
      sendJson(
        res,
        429,
        { error: 'Rate limit exceeded. Maximum 10 requests per minute per IP.' },
        { 'Retry-After': String(limitResult.retryAfterSec) }
      );
      return;
    }
    handleAsk(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/categorize') {
    const ip = getClientIp(req);
    const limitResult = checkRateLimit(ip);
    if (!limitResult.allowed) {
      sendJson(
        res,
        429,
        { error: 'Rate limit exceeded. Maximum 10 requests per minute per IP.' },
        { 'Retry-After': String(limitResult.retryAfterSec) }
      );
      return;
    }
    handleCategorize(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/transcribe') {
    const ip = getClientIp(req);
    const limitResult = checkRateLimit(ip);
    if (!limitResult.allowed) {
      sendJson(
        res,
        429,
        { error: 'Rate limit exceeded. Maximum 10 requests per minute per IP.' },
        { 'Retry-After': String(limitResult.retryAfterSec) }
      );
      return;
    }
    handleTranscribe(req, res);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`API server running at http://${HOST}:${PORT}`);
});
