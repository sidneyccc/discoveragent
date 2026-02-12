const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestLogByIp = new Map();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getClientIp(req) {
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

function getAudioFileExtension(mimeType) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const ip = getClientIp(req);
  const limitResult = checkRateLimit(ip);
  if (!limitResult.allowed) {
    res.setHeader('Retry-After', String(limitResult.retryAfterSec));
    return res.status(429).json({ error: 'Rate limit exceeded. Maximum 10 requests per minute per IP.' });
  }

  const audioBase64 = String(req.body?.audioBase64 || '').trim();
  const mimeType = String(req.body?.mimeType || 'audio/webm').trim();

  if (!audioBase64) {
    return res.status(400).json({ error: 'audioBase64 is required.' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server.' });
  }

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    if (!audioBuffer.length) {
      return res.status(400).json({ error: 'Decoded audio content is empty.' });
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
      return res.status(502).json({ error: 'OpenAI transcription request failed.', details });
    }

    const responseJson = await apiRes.json();
    const transcript =
      typeof responseJson?.text === 'string'
        ? responseJson.text.trim()
        : typeof responseJson?.transcript === 'string'
          ? responseJson.transcript.trim()
          : '';

    return res.status(200).json({
      transcript: transcript || '',
    });
  } catch (error) {
    console.error('Unexpected transcription server error:', error);
    return res.status(500).json({
      error: 'Unexpected transcription server error.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
