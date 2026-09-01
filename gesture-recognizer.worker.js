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
const MODEL_URL = new URL('./assets/vendor/gesture-runtime/hand-gesture.task', self.location.href).href;

let recognizer = null;
let initializing = null;
let visionTasks = null;

function serializeResult(result) {
  const category = result?.gestures?.[0]?.[0] || null;

  return {
    gesture: category?.categoryName || 'None',
    confidence: Number(category?.score || 0),
    landmarks: result?.landmarks?.[0]?.map(({ x, y, z }) => ({ x, y, z })) || [],
  };
}

async function initialize() {
  if (recognizer) return recognizer;
  if (initializing) return initializing;

  initializing = (async () => {
    visionTasks ||= await import('./assets/vendor/gesture-runtime/vision_bundle.mjs');
    const { FilesetResolver, GestureRecognizer } = visionTasks;
    const fileset = await FilesetResolver.forVisionTasks(RUNTIME_ROOT, true);
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
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
