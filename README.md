# @marianmeres/scanner

[![NPM](https://img.shields.io/npm/v/@marianmeres/scanner)](https://www.npmjs.com/package/@marianmeres/scanner)
[![JSR](https://jsr.io/badges/@marianmeres/scanner)](https://jsr.io/@marianmeres/scanner)
[![License](https://img.shields.io/npm/l/@marianmeres/scanner)](LICENSE)

Low-level, framework-agnostic browser primitive for scanning QR codes (and other
barcodes) from a live camera stream. Headless controller with reactive state, plus an
optional mountable "stage" UI (viewfinder overlay, corner guides, control buttons) at
the `/stage` subpath.

Decoding is done by the [`barcode-detector`](https://github.com/Sec-ant/barcode-detector)
ponyfill (zxing-cpp compiled to wasm) — used unconditionally, the native
`BarcodeDetector` is deliberately ignored (platform-inconsistent, historically buggy).

## Installation

```bash
# Deno / JSR
deno add jsr:@marianmeres/scanner

# npm
npm install @marianmeres/scanner
```

## Usage

### Quick start

```typescript
import { createScanner } from "@marianmeres/scanner";
import { createScannerStage } from "@marianmeres/scanner/stage";

const scanner = createScanner({
	onScan: (result) => console.log(result.value),
});

// optional built-in UI — mounts the camera preview + viewfinder into your element
const stage = createScannerStage(scanner, {
	container: document.getElementById("scan")!,
	controls: { cancel: true, torch: true, cameraSwitch: true },
});

// scanning must be started explicitly (ideally from a user gesture — never
// auto-started on mount; iOS Safari permission-prompt rules)
const result = await scanner.start(); // single-shot: resolves with the first hit
console.log(result?.value); // null when cancelled or failed (check state.error)

stage.destroy(); // does NOT destroy the scanner
scanner.destroy();
```

### Single vs continuous mode

```typescript
// "single" (default): auto-stop after the first detection — onScan fires,
// the start() promise resolves with the result, camera is released.
const scanner = createScanner({ mode: "single" });
const result = await scanner.start();

// "continuous": keep scanning until stop()/destroy() — every detection fires
// onScan (identical values suppressed for dedupeMs, default 1500 ms);
// start() resolves null when stopped.
const scanner2 = createScanner({
	mode: "continuous",
	onScan: (r) => console.log(r.format, r.value),
});
// do NOT `await` inline here — in continuous mode the promise resolves only
// once the scanner is stopped
const done = scanner2.start();
// ... later, e.g. from a "done" button handler:
scanner2.stop();
await done; // resolves null
```

### Scan a still image (no camera)

```typescript
import { scanImage } from "@marianmeres/scanner";

// File | Blob | ImageData | ImageBitmap | <img> | <canvas> | <video> | url
const results = await scanImage(file);
if (results.length) console.log(results[0].value);
```

Useful for file uploads, drag & drop, or as a fallback where `getUserMedia` is
unavailable. Unlike the scanner instance methods, `scanImage` THROWS on fetch/decode
failure; an image without any recognizable code resolves with `[]`.

### Torch (flashlight) and camera switching

```typescript
const ok = await scanner.setTorch(true); // resolves false where unsupported

const cameras = await scanner.listCameras(); // [{ deviceId, label, facing }]
await scanner.setCamera(cameras[1].deviceId); // live-switch while scanning
```

### Reactive state

```typescript
// Svelte $store compatible — the callback fires immediately with current state
const unsub = scanner.subscribe((state) => {
	state.status; // "idle" | "initializing" | "scanning" | "stopped"
	state.error; // { code, message } | null — methods never throw
	state.permission; // "unknown" | "prompt" | "granted" | "denied"
	state.torch; // { supported: boolean, on: boolean }
	state.cameras; // CameraInfo[] (labels need granted permission)
	state.activeCameraId; // string | null
	state.lastResult; // ScanResult | null
});
```

### Configuration

```typescript
const scanner = createScanner({
	video: myVideoEl, // created lazily when omitted
	formats: ["qr_code", "ean_13"], // default ["qr_code"]
	mode: "single", // "single" (default) | "continuous"
	onScan: (result) => {},
	onError: (error) => {},
	preferredCamera: "environment", // "environment" (default) | "user" | deviceId
	scanIntervalMs: 100, // decode throttle, default 100 (~10 fps)
	dedupeMs: 1500, // continuous-mode per-value cooldown
	adapter: myCameraAdapter, // camera seam (see below)
	detector: myDetector, // decode-engine seam (tests / engine swap)
	wasmOverrides: { locateFile: (path, prefix) => `/assets/${path}` },
	logger: console, // @marianmeres/clog compatible
});
```

## Semantics

- **Explicit `start()`, never auto-start.** Call it from a user gesture where possible
  — mobile browsers (esp. iOS Safari) tie the permission prompt and playback to
  gestures.
- **HTTPS required.** `getUserMedia` only exists in secure contexts — serve over HTTPS
  (or `localhost` during development). On insecure origins browsers typically don't
  expose `navigator.mediaDevices` at all, so the scanner reports `NOT_SUPPORTED`;
  `INSECURE_CONTEXT` appears when `getUserMedia` itself throws `SecurityError`
  (e.g. a blocking Permissions-Policy).
- **Methods never throw.** `start()` never rejects; errors land in `state.error`
  (`{ code, message }`) and fire `onError`. `setTorch()` resolves `false` instead of
  rejecting. The standalone `scanImage()` is the documented exception — it throws.
- **Permission denial is state, not UI.** A denied prompt sets
  `state.permission = "denied"` plus a `PERMISSION_DENIED` error; the package ships no
  messaging UI for it. For a full "re-enable camera access" walkthrough compose
  [`@marianmeres/mediaperms/reenable-guide`](https://jsr.io/@marianmeres/mediaperms)
  next to the scanner.
- **Single-shot picks the first detection** when several codes share a frame;
  `onScan` fires, `start()` resolves, the loop and all tracks stop
  (`status: "stopped"`).
- **Continuous mode dedupes** identical `format|value` pairs within `dedupeMs`
  (default 1500 ms) and runs until `stop()`/`destroy()`.
- **Concurrent `start()` calls coalesce** — re-entrant calls return the same in-flight
  promise.
- **The detection loop is throttled and visibility-aware.** Frames are scheduled via
  `requestVideoFrameCallback` (rAF fallback), decoded at most every `scanIntervalMs`
  (default 100 ms ≈ 10 fps), and detection pauses while
  `document.visibilityState === "hidden"`.
- **Formats default to `["qr_code"]`.** Fewer enabled formats means faster per-frame
  decode and fewer false positives — enable more (`"ean_13"`, `"code_128"`,
  `"data_matrix"`, … or the `"any"` shortcut) only when needed.
- **Repeated detector failures stop the scan.** After 5 consecutive `detect()` throws
  the scanner sets `DETECTOR_FAILED` and stops.
- **A dying camera track stops the scan.** When the OS/browser ends the video track
  outside the scanner's control (permission revoked mid-scan, USB camera unplugged,
  a native app preempting the camera), the scanner sets `REQUEST_FAILED` and stops
  instead of hanging in `"scanning"`.

### Error codes

Machine-readable codes on `state.error.code` (see
[`ScannerErrorCode`](API.md#scannererrorcode)):

| Code                | Cause                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| `NO_DEVICE`         | `getUserMedia` threw `NotFoundError` — no camera available                           |
| `INSECURE_CONTEXT`  | `SecurityError` — origin not HTTPS, or Permissions-Policy blocks it                  |
| `DEVICE_BUSY`       | `NotReadableError` — hardware held by another consumer                               |
| `PERMISSION_DENIED` | camera access denied by the user or platform policy                                  |
| `REQUEST_FAILED`    | acquisition failed with a non-classified error, or the live track ended unexpectedly |
| `NOT_SUPPORTED`     | required platform API missing (no `mediaDevices`, no DOM, …)                         |
| `DETECTOR_FAILED`   | the barcode detector threw repeatedly (or failed to construct)                       |

## Wasm: CDN default, self-hosting, CSP

The zxing-cpp decoder is a ~1 MB `.wasm` binary fetched **lazily** (on the first
decode) from the **jsDelivr CDN** by default — zero configuration needed.

If your CSP does not allow `cdn.jsdelivr.net` (or you need offline support), self-host
the binary and point the engine at it via `wasmOverrides.locateFile` (passed through to
zxing-wasm's `prepareZXingModule`):

```typescript
const scanner = createScanner({
	wasmOverrides: {
		locateFile: (path: string, prefix: string) => `/assets/${path}`,
	},
});
```

Copy the `zxing_reader.wasm` file from the `zxing-wasm` npm package (a dependency of
`barcode-detector`) into your static assets. Note that executing wasm also requires
`'wasm-unsafe-eval'` in `script-src` under a strict CSP.

## The `CameraAdapter` seam

All camera acquisition goes through an injectable `CameraAdapter` interface
(`getStream`, `enumerateVideoDevices`, `queryPermission`, `onPermissionChange`,
optional `destroy`). The default implementation wraps `navigator.mediaDevices` for
stream acquisition/enumeration and delegates the permission lifecycle to
[`@marianmeres/mediaperms`](https://jsr.io/@marianmeres/mediaperms) — which brings
platform detection, Android-WebView sticky-denial coercion, and bfcache/app-resume
permission rechecks for free.

```typescript
const scanner = createScanner({ adapter: myAdapter }); // fully custom seam

// or share your app's existing mediaperms instance with the default adapter:
import { createCamPerms } from "@marianmeres/mediaperms";
import { createDefaultCameraAdapter, createScanner } from "@marianmeres/scanner";

const perms = createCamPerms(); // app-owned (adapter will not destroy it)
const scanner = createScanner({ adapter: createDefaultCameraAdapter({ perms }) });
```

The adapter seam is also how tests run without real browser APIs.

Unlike `@marianmeres/mediaperms` (which probes permission and stops tracks immediately),
the scanner RETAINS the acquired `MediaStream` for the live preview — all tracks are
stopped on `stop()`/`destroy()`.

## Stage UI: `@marianmeres/scanner/stage`

`createScannerStage(scanner, options)` mounts a self-contained, dependency-free DOM
stage into a container: cover-fit `<video>` preview, dimmed overlay with a rounded
viewfinder cutout and corner guides, an optional scan-line animation
(`prefers-reduced-motion` honored), a brief green flash on detection, and opt-in
control buttons.

```typescript
import { createScannerStage } from "@marianmeres/scanner/stage";

const stage = createScannerStage(scanner, {
	container: document.getElementById("scan")!,
	controls: { cancel: true, torch: true, cameraSwitch: true }, // default { cancel: true }
	scanLine: true, // default true
	theme: "auto", // "auto" (default, follows prefers-color-scheme) | "light" | "dark"
	accent: "#e11d48", // any CSS color, sets --mms-accent
	onCancel: () => console.log("user cancelled"),
});

// later
stage.destroy(); // unmounts the stage; the scanner keeps working independently
```

Buttons for unsupported features hide automatically (torch without capability, camera
switch with a single camera). Theming via scoped CSS custom properties (`--mms-accent`,
`--mms-dim`, `--mms-frame-size`, `--mms-radius`, …) — see
[API.md](API.md#stage-theming-css-custom-properties). The stage is just one consumer of
the headless controller: destroying the stage does not stop or destroy the scanner (and
vice versa).

## API

See [API.md](API.md) for complete API documentation.

## License

[MIT](LICENSE)
