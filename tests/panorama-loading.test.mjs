import test from 'node:test';
import assert from 'node:assert/strict';
import { PanoramaRoom } from '../panorama.js';

function createHarness(t, { uploadError = false } = {}) {
  const requests = [];
  const images = [];
  const revoked = [];
  const deletedTextures = [];
  const states = [];
  const classes = new Set();
  const originalXHR = globalThis.XMLHttpRequest;
  const originalImage = globalThis.Image;
  globalThis.XMLHttpRequest = class {
    constructor() { this.status = 200; requests.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    send() { this.sent = true; }
    abort() { this.aborted = true; this.onabort(); }
  };
  globalThis.Image = class {
    constructor() { images.push(this); this.width = 64; this.height = 32; }
  };
  t.mock.method(URL, 'createObjectURL', () => 'blob:room-texture');
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  t.after(() => {
    globalThis.XMLHttpRequest = originalXHR;
    globalThis.Image = originalImage;
  });
  const room = Object.assign(Object.create(PanoramaRoom.prototype), {
    imageUrl: './assets/room.webp',
    destroyed: false,
    ready: false,
    loadState: { phase: 'downloading', loaded: 0, total: null },
    loadObservers: new Set(),
    stage: {
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
      },
      dispatchEvent() {},
    },
    gl: {
      NO_ERROR: 0,
      getParameter: () => 4096,
      createTexture: () => ({ texture: true }),
      bindTexture() {}, pixelStorei() {}, texParameteri() {}, texImage2D() {},
      getError: () => uploadError ? 1285 : 0,
      deleteTexture: (texture) => deletedTextures.push(texture),
    },
    requestRender() { this.rendered = true; },
  });
  room.readyPromise = new Promise((resolve) => { room.resolveReady = resolve; });
  room.addLoadObserver((state) => states.push(state));
  room.loadTexture();
  const request = requests[0];
  return {
    room, request, requests, images, states, revoked, deletedTextures, classes,
    complete({ status = 200, size = 1024 } = {}) {
      request.status = status;
      request.response = new Blob([new Uint8Array(size)]);
      request.onload();
    },
  };
}

test('同一次图片请求报告真实字节，解码与纹理上传后才就绪并释放临时地址', async (t) => {
  const h = createHarness(t);
  assert.equal(h.request.method, 'GET');
  assert.equal(h.request.responseType, 'blob');
  assert.equal(h.request.sent, true);
  h.request.onprogress({ lengthComputable: true, loaded: 256, total: 1024 });
  assert.deepEqual(h.states.at(-1), { phase: 'downloading', loaded: 256, total: 1024 });
  h.complete();
  assert.equal(h.states.at(-1).phase, 'preparing');
  assert.equal(h.room.ready, false);
  assert.equal(h.images[0].src, 'blob:room-texture');
  h.images[0].onload();
  assert.equal((await h.room.whenReady()).fallback, false);
  assert.equal(h.states.at(-1).phase, 'ready');
  assert.equal(h.room.rendered, true);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.revoked, ['blob:room-texture']);
  assert.equal(h.room.textureRequest, null);
  assert.equal(h.room.textureImage, null);
  let replayed;
  h.room.addLoadObserver((state) => { replayed = state; });
  assert.equal(replayed.phase, 'ready', '缓存命中或晚订阅仍拿到实际状态');
});

test('未知总大小和无法比较的字节计数不产生虚假分母', (t) => {
  const h = createHarness(t);
  for (const event of [
    { lengthComputable: false, loaded: 128, total: 0 },
    { lengthComputable: true, loaded: 128, total: 64 },
  ]) {
    h.request.onprogress(event);
    assert.equal(h.states.at(-1).loaded, 128);
    assert.equal(h.states.at(-1).total, null);
  }
});

test('缓存未产生中间进度事件时仍能完成场景', async (t) => {
  const h = createHarness(t);
  h.complete();
  h.images[0].onload();
  assert.equal((await h.room.whenReady()).fallback, false);
  assert.equal(h.room.ready, true);
});

for (const failure of ['http', 'empty', 'network', 'decode', 'texture']) {
  test(`${failure} 失败开放静态入口且不报告成功`, async (t) => {
    const h = createHarness(t, { uploadError: failure === 'texture' });
    if (failure === 'http') {
      h.request.status = 404;
      h.request.onprogress({ lengthComputable: true, loaded: 1024, total: 1024 });
      assert.equal(h.states.at(-1).loaded, 0, '错误响应体不计作全景资源下载');
      h.complete({ status: 404 });
    }
    if (failure === 'empty') h.complete({ size: 0 });
    if (failure === 'network') h.request.onerror();
    if (failure === 'decode' || failure === 'texture') {
      h.complete();
      if (failure === 'decode') h.images[0].onerror();
      else h.images[0].onload();
      assert.deepEqual(h.revoked, ['blob:room-texture']);
    }
    assert.equal((await h.room.whenReady()).fallback, true);
    assert.equal(h.room.ready, false);
    assert.equal(h.states.at(-1).phase, 'fallback');
    assert.equal(h.classes.has('is-static-fallback'), true);
    if (failure === 'texture') assert.equal(h.deletedTextures.length, 1);
  });
}

test('超时只解除入口等待，晚到图片恢复场景并通知入口清除降级提示', async (t) => {
  const h = createHarness(t);
  h.room.showStaticFallback();
  assert.equal((await h.room.whenReady()).fallback, true);
  assert.notEqual(h.request.aborted, true);
  h.complete();
  h.images[0].onload();
  assert.equal(h.room.ready, true);
  assert.equal(h.states.at(-1).phase, 'ready');
  assert.equal(h.classes.has('is-static-fallback'), false);
});

test('真正离开时取消下载并忽略晚到事件', (t) => {
  const downloading = createHarness(t);
  downloading.room.stopLoading();
  assert.equal(downloading.request.aborted, true);
  downloading.request.onprogress({ lengthComputable: true, loaded: 1024, total: 1024 });
  downloading.complete();
  assert.equal(downloading.room.ready, false);
  assert.equal(downloading.images.length, 0);
  assert.equal(downloading.states.length, 1);
});

test('解码期间离开页面也会释放临时地址和监听', (t) => {
  const decoding = createHarness(t);
  decoding.complete();
  decoding.room.stopLoading();
  assert.deepEqual(decoding.revoked, ['blob:room-texture']);
  assert.equal(decoding.images[0].onload, null);
  assert.equal(decoding.room.loadObservers.size, 0);
});
