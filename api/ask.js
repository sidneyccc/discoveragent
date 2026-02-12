const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const question = String(req.body?.question || '').trim();
  if (!question) {
    return res.status(400).json({ error: 'Question is required.' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server.' });
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
      return res.status(502).json({ error: 'OpenAI request failed.', details });
    }

    const responseJson = await apiRes.json();
    const answer = extractAnswer(responseJson);

    return res.status(200).json({
      answer: answer || 'No answer text returned.',
    });
  } catch (error) {
    console.error('Unexpected server error:', error);
    return res.status(500).json({
      error: 'Unexpected server error.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

