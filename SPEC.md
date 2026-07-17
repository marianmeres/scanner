# @marianmeres/scanner — v1 Specification

Low-level, framework-agnostic browser primitive for scanning QR codes (and other barcodes)
from a live camera stream, with a mountable "stage" UI. Designed to be wrapped later
(e.g. in a Svelte component) and consumed by multiple apps.

Status: **agreed spec, pre-implementation** (interview 2026-07-16).

## 1. Decisions summary

| Topic              | Decision                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decoder engine     | `npm:barcode-detector` (Sec-ant ponyfill, zxing-cpp wasm) — used always, native `BarcodeDetector` ignored                                                                              |
| Default formats    | `["qr_code"]`, configurable (full zxing list: EAN, Code128/39, DataMatrix, PDF417, Aztec, UPC, ITF…)                                                                                   |
| UI                 | Mountable stage with viewfinder overlay + corner guides; opt-in built-in control buttons (torch, camera switch, cancel)                                                                |
| Capabilities       | Single-shot (default, auto-stop) + continuous mode, scan-from-image-file, torch toggle, camera switching                                                                               |
| Result API         | `start(): Promise<ScanResult \| null>` **and** `onScan` callback; reactive state store throughout                                                                                      |
| Permission denial  | State/error codes only — no built-in messaging UI (a camera "reenable guide" belongs to mediaperms later)                                                                              |
| Targets            | Mobile browsers (iOS Safari, Android Chrome) + desktop browsers. In-app WebViews deferred (mediaperms concern)                                                                         |
| Camera acquisition | Isolated behind injectable `CameraAdapter` interface; default adapter delegates the permission lifecycle to `@marianmeres/mediaperms` (integrated 2026-07-16 once the package shipped) |

## 2. Architecture

Follows the micperms blueprint: headless controller + DOM renderer split, reactive state
via `@marianmeres/store`, logging via `@marianmeres/clog`, injectable adapters for
everything that touches the platform.

```
exports:
  "."        → src/mod.ts        headless core (no DOM construction; DOM types only)
  "./stage"  → src/stage.ts      framework-agnostic DOM stage UI
```

### 2.1 Seams (injectable interfaces)

**`CameraAdapter`** — mirrors micperms' `MicPermsBrowserAdapter`, adapted for video.
Key difference vs micperms: the scanner RETAINS the acquired `MediaStream` for the live
preview (micperms probes and stops tracks immediately). All tracks are stopped on
`stop()`/`destroy()`.

```ts
interface CameraAdapter {
	getStream(constraints: MediaStreamConstraints): Promise<MediaStream>;
	enumerateVideoDevices(): Promise<CameraInfo[]>;
	queryPermission(): Promise<PermissionStatusValue | null>; // Permissions API, may be null
	onPermissionChange(cb: (s: PermissionStatusValue) => void): (() => void) | null;
}
```

Default implementation wraps `navigator.mediaDevices` for `getStream`/enumeration and
delegates `queryPermission`/`onPermissionChange` to `@marianmeres/mediaperms`
(`createCamPerms`) — integrated on 2026-07-16 when mediaperms v1.1.1 shipped. mediaperms
deliberately never owns a MediaStream, so stream retention stays scanner-side. A shared
app-owned instance can be passed via `createDefaultCameraAdapter({ perms })`; the
interface gained an optional `destroy()` called by the scanner only for adapters it
created itself.

**`Detector`** — shaped like the W3C BarcodeDetector API so the default is a zero-cost
wrapper around `barcode-detector/ponyfill`:

```ts
interface Detector {
	detect(
		source: HTMLVideoElement | ImageBitmap | ImageData | Blob,
	): Promise<RawDetection[]>;
	getSupportedFormats(): Promise<string[]>;
}
```

Injectable for tests (mock detector) and future engine swaps.

### 2.2 Headless core — `createScanner(config?)`

```ts
const scanner = createScanner({
	video?: HTMLVideoElement,        // consumer-provided; created internally if omitted
	formats?: BarcodeFormat[],       // default ["qr_code"]
	mode?: "single" | "continuous",  // default "single"
	onScan?: (result: ScanResult) => void,
	onError?: (error: ScannerError) => void,
	preferredCamera?: "environment" | "user" | string /* deviceId */, // default "environment"
	scanIntervalMs?: number,         // decode throttle, default ~100 (≈10 fps)
	dedupeMs?: number,               // continuous-mode cooldown per identical value, default 1500
	adapter?: CameraAdapter,         // seam for mediaperms
	detector?: Detector,             // seam for tests/engine swap
	wasm?: { locateFile?: ... },     // pass-through to zxing-wasm prepareZXingModule (self-host / CSP)
	logger?: ...,                    // clog-compatible
});

scanner: {
	subscribe(cb: (s: ScannerState) => void): Unsubscribe;  // svelte-store compatible, fires immediately
	get(): ScannerState;
	start(): Promise<ScanResult | null>;  // single: resolves with first detection, null on cancel
	                                      // continuous: resolves null when stopped; results via onScan
	stop(): void;                         // cancel — stops loop, stops all tracks, resolves start() with null
	listCameras(): Promise<CameraInfo[]>;
	setCamera(deviceId: string): Promise<void>;   // live-switchable while scanning
	setTorch(on: boolean): Promise<boolean>;      // no-op false where unsupported
	destroy(): void;                              // idempotent, releases everything
}
```

**Standalone (no camera):**

```ts
scanImage(source: Blob | File | ImageData | HTMLImageElement | string /* url */, opts?): Promise<ScanResult[]>
```

### 2.3 State & types

```ts
type ScannerStatus = "idle" | "initializing" | "scanning" | "stopped";

interface ScannerState {
	status: ScannerStatus;
	error: ScannerError | null; // { code, message }
	permission: "unknown" | "prompt" | "granted" | "denied";
	torch: { supported: boolean; on: boolean };
	cameras: CameraInfo[]; // populated after first acquire (labels need permission)
	activeCameraId: string | null;
	lastResult: ScanResult | null;
}

interface ScanResult {
	value: string; // decoded payload
	format: BarcodeFormat; // e.g. "qr_code"
	cornerPoints: { x: number; y: number }[];
	boundingBox: DOMRectReadOnly;
	timestamp: number;
}
```

Error codes (superset of micperms taxonomy, same semantics — methods never throw,
errors land in `state.error`):
`NO_DEVICE | INSECURE_CONTEXT | DEVICE_BUSY | PERMISSION_DENIED | REQUEST_FAILED | NOT_SUPPORTED | DETECTOR_FAILED`

Permission denial → `permission: "denied"` + `PERMISSION_DENIED` error. No built-in UI.
(`PERMISSION_DENIED` was added post-interview — a dedicated code is clearer for
consumers than overloading `REQUEST_FAILED`.)

### 2.4 Scanning behavior

- **Explicit `start()`** — never auto-start on mount (user-gesture / permission-prompt rules,
  esp. iOS Safari).
- Detection loop: `requestVideoFrameCallback` where available, rAF fallback; throttled to
  `scanIntervalMs`. Loop pauses while `document.visibilityState === "hidden"`.
- **Single-shot**: first successful detection → `onScan(result)` + `start()` promise resolves →
  loop stops, tracks stop, status `"stopped"`. (If multiple codes in one frame, the first
  detection wins; all are available on the raw detector result.)
- **Continuous**: every detection fires `onScan`, identical values suppressed for `dedupeMs`;
  runs until `stop()`/`destroy()`.
- Multiple concurrent `start()` calls coalesce (micperms in-flight promise pattern).
- Every async resumption point (frame decode, stream acquisition, camera switch,
  torch apply) is generation-guarded — stale continuations from a stopped session
  never touch the session that replaced it (added after adversarial review,
  2026-07-16).
- Concurrent `setCamera()` calls serialize; switching to the active camera no-ops.
- A camera track ending outside our control (permission revoked, device unplugged,
  camera preempted) sets `REQUEST_FAILED` and stops the scan.
- Torch capability is re-probed ~500 ms after stream adoption (Android Chrome
  reports capabilities only once streaming).

### 2.5 Stage UI — `@marianmeres/scanner/stage`

`createScannerStage(scanner, options)` mounts self-contained DOM into a container
(mic-reenable-guide pattern: one injected scoped `<style>`, CSS-var theming, no framework):

- `<video>` preview, cover-fit, `playsinline muted autoplay` attributes handled.
- Dimmed overlay with rounded viewfinder cutout + corner guides (the standard scanning UX).
- Optional scan-line animation (`prefers-reduced-motion` honored).
- Brief success flash/highlight on detection before auto-stop (single-shot).
- **Opt-in control buttons**: `controls: { cancel?: true, torch?: true, cameraSwitch?: true }` —
  rendered unobtrusively, auto-hidden when unsupported (e.g. torch on desktop). Off by
  default except `cancel`; apps wanting custom chrome use the controller API directly.
- Theming via scoped CSS custom properties; `theme: "auto" | "light" | "dark"`.
- Returns `{ el, destroy }`-style handle; destroying the stage does not destroy the scanner
  (and vice versa — the stage is just one consumer of the headless controller).

## 3. Dependencies

| Dep                          | Why                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npm:barcode-detector`       | decode engine (ponyfill; wasm fetched lazily — CDN by default, `wasm.locateFile` config for self-hosting/CSP) |
| `jsr:@marianmeres/store`     | reactive state (svelte-store compatible)                                                                      |
| `jsr:@marianmeres/clog`      | logging (ecosystem rule)                                                                                      |
| `jsr:@b-fuze/deno-dom` (dev) | stage DOM tests                                                                                               |

## 4. Ecosystem conformance checklist

- [ ] `deno.json`: multi-entry `exports` map, `compilerOptions.lib: ["dom","dom.iterable","deno.ns"]`,
      `publish.exclude: [".claude/","tests/","example/","scripts/"]`, `build:example` task,
      `fmt.proseWrap: "preserve"` — mirroring micperms.
- [ ] `scripts/build-npm.ts`: fill `dependencies` list + `entryPoints` for both entries.
- [ ] Docs: `README.md` (badges, install, usage, semantics, API link), `AGENTS.md`, `API.md`,
      `CLAUDE.md` (pointer), `mcp-include.txt`.
- [ ] Tests: `deno test` — core logic with mock `CameraAdapter` + mock `Detector`
      (no real browser APIs); stage tests via deno-dom; `scanImage` enables deterministic
      fixture-based decode tests (real wasm decode runs only in the browser example, not CI).
- [ ] `example/`: vanilla demo page (camera stage + scan result display + torch/switch buttons),
      bundled via `jsr:@marianmeres/deno-build`; plus a sample Svelte wrapper component
      (like micperms' `example/svelte/`).
- [ ] `globalThis` (never `window`); `using`-friendly idempotent unsubscribes/destroy.

## 5. Explicitly out of scope (v1)

- In-app WebView bridge handling at the STREAM level. Permission-level bridges are
  covered since the mediaperms integration (pass `permsConfig` to
  `createDefaultCameraAdapter`).
- Permission-denial guidance UI → compose `@marianmeres/mediaperms/reenable-guide`
  next to the scanner.
- Native `BarcodeDetector` opportunistic use — deliberately skipped (platform-inconsistent,
  historically buggy; the ponyfill is used unconditionally).

## 6. Defaults chosen without interview (veto anytime)

- Decode throttle default ≈ 10 fps; continuous-mode dedupe window 1500 ms.
- wasm served from jsDelivr CDN by default (zero-config), self-host via `wasm` config.
- Stage subpath named `./stage`; success highlight on detection; loop pauses on hidden tab.
- Single-shot picks the first detection when several codes share a frame.
