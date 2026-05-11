#!/usr/bin/env node
// Mock llama-server for testing
// Usage: node mock-llama-server.js --port 9001 [--crash-after 5]

const http = require('http');

const args = process.argv.slice(2);
let port = 9001;
let crashAfter = -1;
let crashImmediate = false;
let pidFile = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = parseInt(args[++i], 10);
  if (args[i] === '--crash-after') crashAfter = parseInt(args[++i], 10);
  if (args[i] === '--crash-immediate') crashImmediate = true;
  if (args[i] === '--pid-file') pidFile = args[++i];
}

if (crashImmediate) {
  console.error('Mock crashing immediately');
  process.exit(1);
}

let requestCount = 0;

const server = http.createServer((req, res) => {
  requestCount++;

  if (crashAfter > 0 && requestCount > crashAfter) {
    process.exit(1);
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url.startsWith('/v1/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock-cmpl',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'mock response' }, finish_reason: 'stop' }],
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, () => {
  if (pidFile) require('fs').writeFileSync(pidFile, String(process.pid));
  console.error(`Mock llama-server listening on :${port}`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
