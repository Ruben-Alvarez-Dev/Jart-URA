const http = require('http');
const url = require('url');

function buildTargetUrl(baseUrl, reqPath) {
  const base = baseUrl.replace(/\/+$/, '');
  const path = reqPath.startsWith('/') ? reqPath : `/${reqPath}`;
  return `${base}${path}`;
}

function createProxy(modelConfig) {
  const { port, name, base_url, api_key_env, api_model } = modelConfig;

  const server = http.createServer((req, res) => {
    const targetUrl = buildTargetUrl(base_url, req.url);
    const parsed = new URL(targetUrl);

    const headers = {
      ...req.headers,
      host: parsed.host,
    };

    const apiKey = process.env[api_key_env];
    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
    delete headers['content-length'];

    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: req.method,
      headers,
      timeout: 60000,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 502;
      const respHeaders = { ...proxyRes.headers };
      delete respHeaders['content-encoding'];
      delete respHeaders['transfer-encoding'];
      res.writeHead(statusCode, respHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API proxy error', proxy_target: base_url }));
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API proxy timeout', proxy_target: base_url }));
      }
    });

    req.pipe(proxyReq);
  });

  server.listen(port, '0.0.0.0');
  console.log(`[jart-ura] API proxy '${name}' on :${port} → ${base_url}`);
  return server;
}

module.exports = { createProxy };
