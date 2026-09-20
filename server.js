'use strict';

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'backend-data.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  if (Buffer.isBuffer(data)) {
    res.end(data);
    return;
  }
  res.end(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function handleApi(req, res) {
  if (req.url !== '/api/data') {
    send(res, 404, { error: 'API khong ton tai' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      send(res, 200, raw);
    } catch (error) {
      send(res, 500, { error: 'Khong doc duoc backend-data.json' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const raw = await readBody(req);
      const data = JSON.parse(raw);
      data.meta = data.meta || {};
      data.meta.updatedAt = new Date().toISOString();
      if (!data.meta.createdAt) data.meta.createdAt = data.meta.updatedAt;
      await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
      send(res, 200, { ok: true, updatedAt: data.meta.updatedAt });
    } catch (error) {
      send(res, 400, { error: 'Du lieu gui len khong hop le' });
    }
    return;
  }

  send(res, 405, { error: 'Method khong duoc ho tro' });
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath);
    send(res, 200, content, MIME[ext] || 'application/octet-stream');
  } catch (error) {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    handleApi(req, res);
    return;
  }
  handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server dang chay: http://localhost:${PORT}`);
});
