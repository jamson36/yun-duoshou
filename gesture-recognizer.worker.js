const reportConsoleError = console.error.bind(console);
console.error = (...parts) => {
  const message = parts.map((part) => String(part)).join(' ');
  if (message.startsWith('INFO: Created TensorFlow Lite')) {
    console.info(...parts);
    return;
  }
  reportConsoleError(...parts);
};

const RUNTIME_ROOT = new URL('./assets/vendor/gesture-runtime/wasm', self.location.href)
  .href
  .replace(/\/$/, '');
const RUNTIME_BUNDLE_URL = new URL(
  './assets/vendor/gesture-runtime/vision_bundle.js',
  self.location.href,
).href;
const RUNTIME_WASM_URL = new URL(
  './assets/vendor/gesture-runtime/wasm/vision_wasm_internal.bin',
  self.location.href,
).href;
const MODEL_URL = new URL('./assets/vendor/gesture-runtime/hand-gesture.bin', self.location.href).href;

importScripts(RUNTIME_BUNDLE_URL);

let recognizer = null;
let initializing = null;

function serializeResult(result) {
  const category = result?.gestures?.[0]?.[0] || null;

  return {
    gesture: category?.categoryName || 'None',
    confidence: Number(category?.score || 0),
    landmarks: result?.landmarks?.[0]?.map(({ x, y, z }) => ({ x, y, z })) || [],
  };
}

async function loadModelAsset() {
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error('gesture-model-unavailable');

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  if (!response.body?.getReader) {
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    self.postMessage({
      type: 'load-progress',
      loadedBytes: modelAssetBuffer.byteLength,
      totalBytes: totalBytes || modelAssetBuffer.byteLength,
    });
    return modelAssetBuffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loadedBytes = 0;
  let lastPercent = -1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.byteLength;
    const percent = totalBytes > 0 ? Math.floor((loadedBytes / totalBytes) * 100) : null;
    if (percent === null || percent >= lastPercent + 2 || loadedBytes >= totalBytes) {
      lastPercent = percent ?? lastPercent;
      self.postMessage({ type: 'load-progress', loadedBytes, totalBytes });
    }
  }

  const modelAssetBuffer = new Uint8Array(loadedBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    modelAssetBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return modelAssetBuffer;
}

async function initialize() {
  if (recognizer) return recognizer;
  if (initializing) return initializing;

  initializing = (async () => {
    const { FilesetResolver, GestureRecognizer } = self.Vision;
    const [fileset, modelAssetBuffer] = await Promise.all([
      FilesetResolver.forVisionTasks(RUNTIME_ROOT, false),
      loadModelAsset(),
    ]);
    fileset.wasmBinaryPath = RUNTIME_WASM_URL;
    self.postMessage({ type: 'runtime-loading' });
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: {
        modelAssetBuffer,
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.58,
      minHandPresenceConfidence: 0.58,
      minTrackingConfidence: 0.56,
    });
    return recognizer;
  })();

  try {
    return await initializing;
  } finally {
    initializing = null;
  }
}

self.addEventListener('message', async (event) => {
  const { type } = event.data || {};

  if (type === 'init') {
    try {
      await initialize();
      self.postMessage({ type: 'ready' });
    } catch {
      self.postMessage({ type: 'error', code: 'runtime-init' });
    }
    return;
  }

  if (type === 'frame') {
    const { bitmap, timestampMs } = event.data;
    try {
      const activeRecognizer = await initialize();
      const startedAt = performance.now();
      const result = activeRecognizer.recognizeForVideo(bitmap, timestampMs);
      self.postMessage({
        type: 'result',
        ...serializeResult(result),
        inferenceMs: Math.round((performance.now() - startedAt) * 10) / 10,
      });
    } catch {
      self.postMessage({ type: 'frame-error', code: 'recognition' });
    } finally {
      bitmap?.close?.();
    }
    return;
  }

  if (type === 'stop') {
    try {
      recognizer?.close?.();
    } finally {
      recognizer = null;
      self.postMessage({ type: 'stopped' });
    }
  }
});
