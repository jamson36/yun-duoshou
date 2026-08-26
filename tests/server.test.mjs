import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';

async function withServer(options, run) {
  const server = createAppServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('健康检查不暴露密钥并报告配置状态', async () => {
  await withServer({ apiKey: 'secret-test-key' }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.aiConfigured, true);
    assert.equal(Object.hasOwn(payload, 'model'), false);
    assert.equal(JSON.stringify(payload).includes('secret-test-key'), false);
  });
});

test('公开静态资源不暴露复诊服务商或模型名称', async () => {
  await withServer({}, async (baseUrl) => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/app.js`),
      fetch(`${baseUrl}/intro-transition.js`),
      fetch(`${baseUrl}/styles.css`),
    ]);
    const publicSource = (await Promise.all(responses.map((response) => response.text()))).join('\n');
    assert.doesNotMatch(publicSource, /deepseek/i);
  });
});

test('同源服务能返回首页和安全响应头', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /让你花个爽/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  });
});

test('开屏逻辑与高清房间素材可由静态白名单访问', async () => {
  await withServer({}, async (baseUrl) => {
    const [script, panorama] = await Promise.all([
      fetch(`${baseUrl}/intro-transition.js`),
      fetch(`${baseUrl}/assets/room-panorama-hd.webp`, { method: 'HEAD' }),
    ]);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.equal(panorama.status, 200);
    assert.equal(panorama.headers.get('content-type'), 'image/webp');
  });
});

test('拒绝访问服务器源码目录', async () => {
  await withServer({}, async (baseUrl) => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/server/diagnosis-service.mjs`),
      fetch(`${baseUrl}/server.mjs`),
      fetch(`${baseUrl}/.env.example`),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [404, 404, 404]);
  });
});
