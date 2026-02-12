const http = require('http');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3001);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TRUSTED_SOURCES = [
  'Reuters',
  'AP News',
  'BBC',
  'NPR',
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
5) Hacker News
6) Reddit
7) Stack Overflow
8) Wikipedia

Instructions:
- Categorize the response into source-based opinion buckets.
- Cluster by trusted-source alignment: group trusted sources that express similar opinions into one cluster.
- Consolidate similar opinions into a single paragraph per cluster rather than repeating per source.
- Prefer the prioritized trusted sources above when relevant.
- If information is not available from the trusted list, you may include additional sources, but mark them clearly as "Additional source (not in prioritized list)".
- Do not invent direct quotes or fake citations.
- Keep output concise and structured with headings.
- Use clear paragraph breaks. Do not return one long line.
- Keep total output at or below 500 words.
- End with a short "Coverage Notes" section calling out where evidence is weak or inferred.
`.trim();

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

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    handleAsk(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/categorize') {
    handleCategorize(req, res);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`API server running at http://${HOST}:${PORT}`);
});
