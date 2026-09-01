# Hand gesture runtime notice

This directory contains files used only by the optional, browser-local room
gesture controller.

## MediaPipe Tasks Vision

- Package: `@mediapipe/tasks-vision@1.0.1`
- Source package: <https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.0.1>
- License: Apache License 2.0 (see `LICENSE`)
- Vendored files:
  - `vision_bundle.js`
  - `wasm/vision_wasm_internal.js`
  - `wasm/vision_wasm_internal.wasm`

SHA-256:

```text
98db72469ffb176f5e9f2687be0f70783893aca681f7789c34b872b0a764371a  vision_bundle.js
e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73  wasm/vision_wasm_internal.js
8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886  wasm/vision_wasm_internal.wasm
```

## Gesture recognizer model

- Model: Gesture Recognizer, float16, version 1
- Source: <https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task>
- File: `hand-gesture.task`
- SHA-256: `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`

The application serves these files from its own origin. Camera frames stay in
the browser process and are not uploaded to the application API.
