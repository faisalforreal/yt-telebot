import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import authLoginHandler from './api/auth/login.js';
import authCallbackHandler from './api/auth/callback.js';
import webhookHandler from './api/webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

export default async function app(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Polyfill helpers
  if (!res.status) {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.send) {
    res.send = (body) => {
      if (typeof body === 'object') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end(body);
      }
    };
  }
  if (!res.json) {
    res.json = (body) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
  }
  if (!res.redirect) {
    res.redirect = (statusOrUrl, url) => {
      const targetUrl = typeof statusOrUrl === 'number' ? url : statusOrUrl;
      const statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
      res.writeHead(statusCode, { Location: targetUrl });
      res.end();
    };
  }

  req.query = req.query || Object.fromEntries(parsedUrl.searchParams);

  if (pathname === '/api/auth/login') {
    return authLoginHandler(req, res);
  }

  if (pathname === '/api/auth/callback') {
    return authCallbackHandler(req, res);
  }

  if (pathname === '/api/webhook') {
    if (req.body) {
      return webhookHandler(req, res);
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      req.body = body;
      return webhookHandler(req, res);
    });
    return;
  }

  // Static files
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveStatic(res, filePath);
  }

  return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
}

// Standalone mode when running locally
if (!process.env.VERCEL) {
  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`🌐 Web portal listening on port ${PORT}`);
    console.log(`Landing page: http://localhost:${PORT}`);
  });
}
