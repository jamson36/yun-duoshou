import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEEPSEEK_DEFAULTS, ServiceError, requestDeepSeekDiagnosis } from './server/diagnosis-service.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const ASSETS_ROOT = resolve(ROOT, 'assets');
const MAX_BODY_BYTES = 64 * 1024;
const PUBLIC_ROOT_FILES = new Set(['index.html', 'styles.css', 'app.js', 'analysis-stages.js', 'budget-goals.js', 'budget-whiteboard.js', 'gachapon-motion.js', 'gesture-controls.js', 'gesture-recognizer.worker.js', 'gesture-ui.js', 'goal-date-picker.js', 'intro-transition.js', 'orientation-controls.js', 'orientation-ui.js', 'panorama.js', 'persona-presentations.js', 'route-sync.js', 'scene-config.js', 'personality-scoring.js', 'share-poster.js']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

function securityHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), accelerometer=(self), gyroscope=(self), magnetometer=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  };
}

function jsonResponse(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, { ...securityHeaders(), 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ServiceError('request_too_large', '请求内容过大', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) throw new ServiceError('invalid_request', '请求内容为空', 400);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ServiceError('invalid_json', '请求不是有效 JSON', 400);
  }
}

function clientAddress(request) {
  const forwarded = request.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : (forwarded || request.socket.remoteAddress || 'unknown')).split(',')[0].trim();
}

function createRateLimiter({ limit = 20, windowMs = 10 * 60 * 1000 } = {}) {
  const clients = new Map();
  return (key) => {
    const now = Date.now();
    const current = clients.get(key);
    if (!current || current.resetAt <= now) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1 };
    }
    current.count += 1;
    if (clients.size > 2000) {
      for (const [client, value] of clients) if (value.resetAt <= now) clients.delete(client);
    }
    return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count) };
  };
}

function pathIsWithin(root, target) {
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target.startsWith(rootPrefix);
}

function staticPath(rawPathname) {
  if (typeof rawPathname !== 'string' || !rawPathname.startsWith('/') || rawPathname.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(rawPathname) || /%(?:2f|5c)/i.test(rawPathname)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname === '/' ? '/index.html' : rawPathname);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)
    || decoded.includes('//')
    || /%(?:2e|2f|5c)/i.test(decoded)
    || decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  const relative = decoded.slice(1);
  if (PUBLIC_ROOT_FILES.has(relative)) return resolve(ROOT, relative);
  if (!decoded.startsWith('/assets/')) return null;
  const assetRelative = decoded.slice('/assets/'.length);
  if (!assetRelative) return null;
  const absolute = resolve(ASSETS_ROOT, assetRelative);
  if (!pathIsWithin(ASSETS_ROOT, absolute)) return null;
  return absolute;
}

function rawRequestPathname(requestUrl) {
  const value = typeof requestUrl === 'string' && requestUrl ? requestUrl : '/';
  const queryIndex = value.indexOf('?');
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}

async function serveStatic(request, response, pathname) {
  const filePath = staticPath(pathname);
  if (!filePath) return false;
  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch {
    return false;
  }
  if (!fileInfo.isFile()) return false;
  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
  response.writeHead(200, {
    ...securityHeaders(contentType),
    'Content-Length': fileInfo.size,
    'Cache-Control': pathname === '/' || pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(filePath).pipe(response);
  return true;
}

export function createAppServer({
  apiKey = process.env.DEEPSEEK_API_KEY || '',
  model = process.env.DEEPSEEK_MODEL || DEEPSEEK_DEFAULTS.model,
  baseUrl = process.env.DEEPSEEK_API_BASE_URL || DEEPSEEK_DEFAULTS.baseUrl,
  fetchImpl = globalThis.fetch,
  rateLimit = 20,
} = {}) {
  const checkRateLimit = createRateLimiter({ limit: rateLimit });
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const url = new URL(request.url || '/', 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        jsonResponse(response, 200, { status: 'ok', aiConfigured: Boolean(apiKey) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/ai/diagnosis') {
        const rate = checkRateLimit(clientAddress(request));
        if (!rate.allowed) throw new ServiceError('rate_limited', '请求过于频繁，请稍后再试', 429);
        const input = await readJsonBody(request);
        const diagnosis = await requestDeepSeekDiagnosis({ input, apiKey, model, baseUrl, fetchImpl });
        jsonResponse(response, 200, { requestId, ...diagnosis }, { 'X-RateLimit-Remaining': String(rate.remaining) });
        console.info(JSON.stringify({ requestId, event: 'ai_diagnosis', status: 'ok', durationMs: Date.now() - startedAt }));
        return;
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
        const pathname = rawRequestPathname(request.url);
        if (await serveStatic(request, response, pathname)) return;
      }
      jsonResponse(response, 404, { code: 'not_found', message: '未找到请求的资源' });
    } catch (error) {
      const serviceError = error instanceof ServiceError
        ? error
        : new ServiceError('server_error', '服务暂时不可用', 500);
      jsonResponse(response, serviceError.status, { requestId, code: serviceError.code, message: serviceError.message });
      console.warn(JSON.stringify({ requestId, event: url.pathname, status: serviceError.code, durationMs: Date.now() - startedAt }));
    }
  });
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryUrl) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  const server = createAppServer();
  server.listen(port, host, () => {
    console.info(`让你花个爽！服务已启动：http://${host}:${port}`);
  });
}
