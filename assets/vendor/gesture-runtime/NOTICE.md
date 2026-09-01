# Hand gesture runtime notice

This directory contains files used only by the optional, browser-local room
gesture controller.

## MediaPipe Tasks Vision

- Package: `@mediapipe/tasks-vision@1.0.1`
- Source package: <https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.0.1>
- License: Apache License 2.0 (see `LICENSE`)
- Vendored files:
  - `vision_bundle.mjs`
  - `wasm/vision_wasm_module_internal.js`
  - `wasm/vision_wasm_module_internal.wasm`

SHA-256:

```text
d885630c297c0b20b1fe86096cb06291c4c8080876f27852e724f24ac603713f  vision_bundle.mjs
da8934057f147b622e82cfb4c0dbd85461c598e268588b5a8ba9ca963a8ff82d  wasm/vision_wasm_module_internal.js
2dabd8e23c60984628beb7bb338764c81a08e6837145273f59578684b5d53c1b  wasm/vision_wasm_module_internal.wasm
```

## Gesture recognizer model

- Model: Gesture Recognizer, float16, version 1
- Source: <https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task>
- File: `hand-gesture.task`
- SHA-256: `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`

The application serves these files from its own origin. Camera frames stay in
the browser process and are not uploaded to the application API.
