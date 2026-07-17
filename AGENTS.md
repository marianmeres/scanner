# @marianmeres/scanner — Agent Guide

## Quick Reference

- **Stack**: Deno, TypeScript, browser-targeted (DOM libs enabled)
- **Runtime dependencies**: `barcode-detector` (npm; zxing-cpp wasm ponyfill),
  `@marianmeres/store` (reactive store, Svelte-compatible `subscribe`),
  `@marianmeres/clog` (logging), `@marianmeres/mediaperms` (permission lifecycle
  inside the default CameraAdapter)
- **Test**: `deno task test` | **Build example**: `deno task build:example` |
  **Format**: `deno fmt`

## Project Structure

```
/src
  mod.ts             — Main entry: re-exports everything below (headless, no DOM construction)
  types.ts           — All public types/interfaces + ScannerErrorCode const
  scanner.ts         — createScanner() core (state, detection loop, start/stop lifecycle)
  camera-adapter.ts  — createDefaultCameraAdapter() (navigator.mediaDevices streams + mediaperms permission lifecycle), detectFacing()
  detector.ts        — createDefaultDetector() (barcode-detector ponyfill), toScanResult(), DEFAULT_FORMATS
  scan-image.ts      — scanImage() standalone still-image decode
  stage.ts           — Subpath export "./stage": createScannerStage() DOM viewfinder UI
/tests
  _helpers.ts            — Shared test doubles (mock adapter/detector/track/stream/video, recording logger)
  scanner.test.ts        — Core lifecycle/scan-loop tests (mock adapter + detector, no real browser APIs)
  camera-adapter.test.ts — Default adapter tests (fake navigator.mediaDevices, injected fake mediaperms)
  scan-image.test.ts     — scanImage() mapping/throw/fetch tests
  stage.test.ts          — Stage DOM tests (@b-fuze/deno-dom + mock Scanner)
/scripts
  build-npm.ts       — NPM package build (@marianmeres/npmbuild; entryPoints: mod, stage)
SPEC.md              — Agreed v1 spec (design rationale)
```

## What This Library Does

Framework-agnostic browser primitive for scanning QR/barcodes from a live camera
stream: headless controller (`createScanner`) with reactive state, single-shot and
continuous modes, torch + camera switching, standalone still-image decode
(`scanImage`), and a mountable viewfinder stage UI (`createScannerStage`, `/stage`
subpath).

Decoding always uses the `barcode-detector` ponyfill (zxing-cpp wasm) — the native
`BarcodeDetector` is deliberately NOT used. The ~1 MB wasm loads lazily from the
jsDelivr CDN by default; `wasmOverrides.locateFile` enables self-hosting (CSP).

## Key Concepts

| Concept                | Description                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CameraAdapter**      | Injectable seam for camera acquisition; default wraps `navigator.mediaDevices` for streams/enumeration and delegates the permission lifecycle to `@marianmeres/mediaperms` (share an app-owned instance via `createDefaultCameraAdapter({ perms })`). |
| **Detector**           | Injectable seam for the decode engine (W3C `BarcodeDetector`-shaped); default wraps the ponyfill. Mock in tests.                                                                                                                                      |
| **Reactive state**     | `@marianmeres/store` powers `subscribe()` (Svelte `$store` compatible, fires immediately)                                                                                                                                                             |
| **Never-throw**        | Scanner methods never throw/reject — errors land in `state.error` (`ScannerErrorCode`)                                                                                                                                                                |
| **Stream retention**   | Unlike mediaperms (probe + stop), the scanner RETAINS the `MediaStream` for the live preview; tracks stop on `stop()`/`destroy()`                                                                                                                     |
| **Headless/DOM split** | Core constructs no DOM (video element lazily, only when needed); all chrome lives in `stage.ts`                                                                                                                                                       |

## Public API

### Main entry (`@marianmeres/scanner`)

| Export                            | Type     | Purpose                                                                                                            |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `createScanner(config?)`          | Factory  | Main entry point, returns `Scanner` instance                                                                       |
| `scanImage(source, options?)`     | Function | Decode a still image (Blob/File/ImageData/img/canvas/url). THROWS on failure (documented exception to never-throw) |
| `createDefaultCameraAdapter(o?)`  | Factory  | Real browser adapter (`getUserMedia` streams + mediaperms permissions; `{ perms, permsConfig }` options)           |
| `createDefaultDetector(options?)` | Factory  | Ponyfill-backed `Detector` (formats + `wasmOverrides`)                                                             |
| `classifyAcquireError(e)`         | Helper   | Map a `getUserMedia` rejection to `ScannerError`                                                                   |
| `detectFacing(label)`             | Helper   | Best-effort `"user"`/`"environment"`/`null` from device label                                                      |
| `toScanResult(d, timestamp?)`     | Helper   | Raw detection → public `ScanResult`                                                                                |
| `ScannerErrorCode`                | Const    | Frozen object of typed `state.error.code` values                                                                   |
| `DEFAULT_FORMATS`                 | Const    | `["qr_code"]`                                                                                                      |

### Stage subpath (`@marianmeres/scanner/stage`)

| Export                                 | Type    | Purpose                                                                                                                                                                               |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createScannerStage(scanner, options)` | Factory | Mounts viewfinder UI (video, overlay cutout, corner guides, scan line, opt-in cancel/torch/switch buttons) into a container. Returns `{ el, destroy }`. THROWS without DOM/container. |

### Scanner instance methods

| Method                | Returns                       | Description                                                                                                          |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `subscribe(cb)`       | `() => void`                  | Reactive subscription (fires immediately)                                                                            |
| `get()`               | `ScannerState`                | Current state snapshot                                                                                               |
| `start()`             | `Promise<ScanResult \| null>` | Acquire camera + scan. Single: first hit; continuous: `null` when stopped. Concurrent calls coalesce. Never rejects. |
| `stop()`              | `void`                        | Cancel: stop loop + tracks, resolve pending `start()` with `null`                                                    |
| `listCameras()`       | `Promise<CameraInfo[]>`       | Enumerate devices (also updates `state.cameras`)                                                                     |
| `setCamera(deviceId)` | `Promise<void>`               | Live-switch while scanning; otherwise applied on next `start()`                                                      |
| `setTorch(on)`        | `Promise<boolean>`            | `false` when unsupported/failed (never rejects)                                                                      |
| `getVideo()`          | `HTMLVideoElement \| null`    | Preview element (lazily created; `null` without DOM)                                                                 |
| `destroy()`           | `void`                        | Release everything. Idempotent.                                                                                      |

## Critical Conventions

1. Use `globalThis` never `window` (Deno compatibility)
2. Scanner methods never throw — classify failures into `state.error` via
   `classifyAcquireError` / `ScannerErrorCode`. Exceptions: standalone `scanImage()`
   and the stage factory throw by design.
3. Permission denial (`NotAllowedError`) sets `state.permission = "denied"` +
   a dedicated `PERMISSION_DENIED` error — but there is no built-in denial UI
   (mediaperms territory).
4. Tests use injectable `adapter` + `detector` — never depend on real browser APIs;
   real wasm decode runs only in the browser example, not CI.
5. `start()` caches an in-flight promise (concurrent calls coalesce); async init is
   guarded by a `generation` counter — keep both when touching lifecycle code.
6. Detection loop: `requestVideoFrameCallback` → rAF → `setTimeout` fallback;
   throttled by `scanIntervalMs`; skips while `document.visibilityState === "hidden"`
   or `paused` (live camera switch); stops after 5 consecutive detector failures
   (`DETECTOR_FAILED`).
7. The default detector is created lazily inside `start()` (wasm cost only when
   used); `scanImage` creates its own unless given one.
8. Stage is a pure consumer of the headless controller — no scanner state lives in
   `stage.ts`; destroying one never destroys the other.
9. Never auto-start on mount — `start()` must remain an explicit call (iOS Safari
   gesture/permission rules).
10. Format: tabs, 90-char line width, 4-space indent width (`deno fmt`)

## Before Making Changes

- [ ] Read `SPEC.md` for design decisions and out-of-scope items
- [ ] Read `src/types.ts` first — all public contracts live there
- [ ] Check existing patterns (mediaperms is the architectural blueprint)
- [ ] Run `deno task test`
- [ ] Run `deno fmt` and `deno check src/mod.ts src/stage.ts`

## Platform Notes

- **HTTPS required**: `getUserMedia` exists only in secure contexts (localhost OK).
  On insecure origins browsers typically omit `navigator.mediaDevices` entirely →
  `NOT_SUPPORTED`; `INSECURE_CONTEXT` means getUserMedia threw `SecurityError`
  (e.g. Permissions-Policy).
- **Camera labels are empty** until permission has been granted at least once; the
  scanner re-enumerates after a successful `start()`.
- **Mobile browsers cannot open two cameras at once** — `setCamera()` stops the
  current tracks before acquiring the new stream.
- **Torch** is a track capability (`getCapabilities().torch`) — effectively
  Android/Chrome only; always feature-detected, `setTorch()` resolves `false`
  elsewhere.
- **In-app WebView specifics are handled at the permission level only** — the
  default adapter's mediaperms delegation brings platform detection and
  webview-bridge awareness (pass `permsConfig` through
  `createDefaultCameraAdapter`); stream acquisition quirks of exotic WebViews
  remain untested.
