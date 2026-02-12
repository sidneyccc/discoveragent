const http = require('http');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3001);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
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

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    handleAsk(req, res);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`API server running at http://${HOST}:${PORT}`);
});
