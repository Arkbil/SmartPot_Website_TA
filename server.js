const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, 'public');
const files = new Map([
  ['/', { name: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { name: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/dashboard.js', { name: 'dashboard.js', type: 'text/javascript; charset=utf-8' }]
]);

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://visvnsijjuqnlpzravjl.supabase.co wss://visvnsijjuqnlpzravjl.supabase.co; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function send(response, status, body, type = 'text/plain; charset=utf-8', headOnly = false) {
  response.writeHead(status, {
    ...securityHeaders,
    'Cache-Control': 'no-store',
    'Content-Type': type
  });
  response.end(headOnly ? undefined : body);
}

const server = http.createServer(async (request, response) => {
  const headOnly = request.method === 'HEAD';
  if (request.method !== 'GET' && !headOnly) {
    response.setHeader('Allow', 'GET, HEAD');
    send(response, 405, 'Method Not Allowed');
    return;
  }

  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/health') {
    send(response, 200, JSON.stringify({ status: 'ok' }), 'application/json; charset=utf-8', headOnly);
    return;
  }

  const file = files.get(pathname);
  if (!file) {
    send(response, 404, 'Not Found');
    return;
  }

  try {
    const body = await readFile(path.join(publicDirectory, file.name));
    send(response, 200, body, file.type, headOnly);
  } catch {
    send(response, 500, 'Internal Server Error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Smart Pot web service listening on port ${port}`);
});

