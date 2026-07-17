# API

Package exports:

- `@marianmeres/scanner` — headless core (no DOM construction; DOM types only)
- `@marianmeres/scanner/stage` — framework-agnostic DOM stage UI

## Functions

### `createScanner(config?)`

Create a headless (no UI) camera barcode scanner.

Reactive state is exposed via the svelte-store-compatible `subscribe`/`get`. Methods
never throw — errors land in `state.error` (see
[`ScannerErrorCode`](#scannererrorcode)).

**Parameters:**

- `config` (`ScannerConfig`, optional) — Configuration options. See
  [`ScannerConfig`](#scannerconfig).

**Returns:** `Scanner` — Scanner instance with reactive state

**Example:**

```typescript
const scanner = createScanner({ onScan: (r) => console.log(r.value) });
const result = await scanner.start(); // single-shot: auto-stops on first hit
scanner.destroy();
```

---

### `scanImage(source, options?)`

Decode barcodes from a still image — no camera involved. Useful for file uploads,
drag & drop, or as a fallback where `getUserMedia` is unavailable.

Unlike the scanner instance methods (which never throw), this standalone utility
**THROWS** on fetch/decode failure. An image without any recognizable code resolves
with `[]` (not an error).

**Parameters:**

- `source` (`DetectorSource | string`) — The image to decode: `Blob` / `File`,
  `ImageData`, `ImageBitmap`, `HTMLImageElement`, `HTMLCanvasElement`,
  `HTMLVideoElement`, or a URL string (fetched, then decoded as a `Blob`).
- `options` (`ScanImageOptions`, optional)
  - `options.formats` (`BarcodeFormat[]`) — Formats to detect. Default `["qr_code"]`.
  - `options.detector` (`Detector`) — Decoding engine seam. Default wraps the
    `barcode-detector` ponyfill.
  - `options.wasmOverrides` (`Record<string, unknown>`) — See
    [`ScannerConfig.wasmOverrides`](#scannerconfig).

**Returns:** `Promise<ScanResult[]>` — All detections found in the image (all share
one timestamp).

**Example:**

```typescript
const results = await scanImage(file); // File | Blob | ImageData | <img> | url
if (results.length) console.log(results[0].value);
```

---

### `createDefaultCameraAdapter(options?)`

Create the default [`CameraAdapter`](#cameraadapter). Stream acquisition and
device enumeration wrap `navigator.mediaDevices` directly (the scanner must
RETAIN the stream — deliberately out of mediaperms' scope); the permission
lifecycle (query + change tracking, Android-WebView sticky-denial coercion,
bfcache/app-resume rechecks) is delegated to `@marianmeres/mediaperms`. Used
internally when no `config.adapter` is given; exported for consumers who want
to share a mediaperms instance or extend the default behavior.

**Parameters:**

- `options` (`CreateDefaultCameraAdapterOptions`, optional):
  - `perms` (`MediaPerms`, optional) — share an existing app-owned
    `@marianmeres/mediaperms` instance (camera kind). The adapter will NOT
    destroy a shared instance. When omitted, the adapter lazily creates its
    own via `createCamPerms()` and destroys it in `destroy()`.
  - `permsConfig` (`MediaPermsConfig`, optional) — forwarded to
    `createCamPerms()` when the adapter creates its own instance (platform
    hints, webview bridges, logger…). Ignored when `perms` is provided.

**Returns:** `CameraAdapter`

**Example:**

```typescript
import { createCamPerms } from "@marianmeres/mediaperms";

// self-contained (internal mediaperms instance):
const scanner = createScanner({ adapter: createDefaultCameraAdapter() });

// or share the app's instance:
const perms = createCamPerms();
const adapter = createDefaultCameraAdapter({ perms });
const scanner2 = createScanner({ adapter });
```

---

### `createDefaultDetector(options?)`

Create the default [`Detector`](#detector) wrapping the `barcode-detector` ponyfill
(zxing-cpp wasm engine, all major 1D/2D formats).

NOTE: the ~1 MB decoder `.wasm` is fetched lazily (on first `detect()`) from the
jsDelivr CDN by default — pass `wasmOverrides.locateFile` to self-host it.

**Parameters:**

- `options` (`CreateDefaultDetectorOptions`, optional)
  - `options.formats` (`BarcodeFormat[]`) — Formats to detect. Default `["qr_code"]`.
  - `options.wasmOverrides` (`Record<string, unknown>`) — Overrides passed to
    zxing-wasm's `prepareZXingModule` — most notably `locateFile` for self-hosting
    the `.wasm` binary.

**Returns:** `Detector`

**Example:**

```typescript
const detector = createDefaultDetector({
	formats: ["qr_code", "ean_13"],
	wasmOverrides: { locateFile: (path: string) => `/assets/${path}` },
});
const scanner = createScanner({ detector });
```

---

### `classifyAcquireError(e)`

Classify a `getUserMedia` (or adapter) rejection into a [`ScannerError`](#scannererror).
Maps `NotFoundError`/`DevicesNotFoundError` → `NO_DEVICE`, `SecurityError` →
`INSECURE_CONTEXT`, `NotReadableError`/`TrackStartError` → `DEVICE_BUSY`,
`NotSupportedError` → `NOT_SUPPORTED`, anything else → `REQUEST_FAILED`. Note:
permission denial (`NotAllowedError`/`PermissionDeniedError`) is handled
separately by the scanner (→ `PERMISSION_DENIED` + `state.permission =
"denied"`) before this classifier applies. Used internally; exported for
custom adapters that want identical taxonomy.

**Parameters:**

- `e` (`unknown`) — The thrown value (typically a `DOMException`).

**Returns:** `ScannerError` — `{ code, message }`

---

### `detectFacing(label)`

Best-effort camera facing detection from a device label (`/back|rear|environment/i`
→ `"environment"`, `/front|user|facetime|selfie/i` → `"user"`).

**Parameters:**

- `label` (`string`) — Device label as reported by `enumerateDevices`.

**Returns:** `CameraFacing | null` — `null` when the label matches neither pattern.

---

### `toScanResult(d, timestamp?)`

Map a raw detection ([`DetectedBarcodeLike`](#detectedbarcodelike)) to the public
[`ScanResult`](#scanresult) shape. Used internally; useful when implementing a custom
`Detector`.

**Parameters:**

- `d` (`DetectedBarcodeLike`) — The raw detection.
- `timestamp` (`number`, optional) — Detection timestamp. Default `Date.now()`.

**Returns:** `ScanResult`

---

## Scanner Instance

Returned by `createScanner()`. After `destroy()`, the lifecycle methods become
no-ops (`start()` logs a warning and resolves `null`, `setTorch()` resolves `false`);
`subscribe()`/`get()` keep working on the final state.

### `subscribe(cb)`

Subscribe to reactive state changes. Callback fires immediately with the current
state, then on every change. Compatible with Svelte's `$store` contract.

**Parameters:**

- `cb` (`(state: ScannerState) => void`) — State callback

**Returns:** `Unsubscribe` (from `@marianmeres/store`) — idempotent unsubscribe
function that also implements `Symbol.dispose` (usable with `using`)

---

### `get()`

Get the current state snapshot.

**Returns:** `ScannerState`

---

### `start()`

Acquire the camera and start scanning. Never rejects.

- `"single"` mode: resolves with the first [`ScanResult`](#scanresult), or `null` when
  cancelled via `stop()` (or on failure — check `state.error`).
- `"continuous"` mode: resolves `null` when stopped.

Concurrent calls while active return the same in-flight promise. On acquisition
failure the status returns to `"idle"`; after a successful scan/cancel it is
`"stopped"`. A permission denial additionally sets `state.permission = "denied"`.

**Returns:** `Promise<ScanResult | null>`

---

### `stop()`

Cancel: stop the detection loop, release the camera (all tracks stopped, video
`srcObject` detached), resolve a pending `start()` with `null`, set status
`"stopped"`. No-op when nothing is running.

**Returns:** `void`

---

### `listCameras()`

List available video input devices (also updates `state.cameras`). NOTE: browsers
return empty labels until camera permission has been granted at least once — the
scanner re-enumerates automatically after a successful `start()`. Resolves `[]` on
enumeration failure (never rejects).

**Returns:** `Promise<CameraInfo[]>`

---

### `setCamera(deviceId)`

Switch to another camera. While scanning, performs a live switch (the current stream
is released first — most mobile browsers cannot open two cameras at once); otherwise
the device is remembered and applied on the next `start()`. Concurrent calls are
serialized (the second switch runs after the first completes); switching to the
already-active camera is a no-op. On a failed live switch the error is classified
into `state.error` and the scanner stops.

**Parameters:**

- `deviceId` (`string`) — Device id from [`CameraInfo`](#camerainfo).

**Returns:** `Promise<void>`

---

### `setTorch(on)`

Turn the torch (flashlight) on/off via `MediaStreamTrack.applyConstraints`. Resolves
`true` on success, `false` when unsupported or failed (never rejects). Support is
reflected in `state.torch.supported` — probed at stream acquisition and re-probed
~500 ms later (Android Chrome reports track capabilities only once the camera is
actually streaming); the torch resets to off on stream release/switch.

**Parameters:**

- `on` (`boolean`) — Desired torch state.

**Returns:** `Promise<boolean>`

---

### `getVideo()`

The video element used for the live preview. Lazily created when none was configured
(with `playsinline`, `muted`, `autoplay` handled); returns `null` in non-DOM
environments. The shipped stage UI renders this element.

**Returns:** `HTMLVideoElement | null`

---

### `destroy()`

Stop everything and release all resources/listeners (including the permission-change
subscription). Idempotent.

**Returns:** `void`

---

## Types

### `ScannerConfig`

```typescript
interface ScannerConfig {
	video?: HTMLVideoElement;
	formats?: BarcodeFormat[]; // default ["qr_code"]
	mode?: ScanMode; // default "single"
	onScan?: (result: ScanResult) => void;
	onError?: (error: ScannerError) => void;
	preferredCamera?: CameraFacing | (string & Record<never, never>); // default "environment"
	scanIntervalMs?: number; // default 100 (~10 fps)
	dedupeMs?: number; // default 1500
	adapter?: CameraAdapter;
	detector?: Detector;
	wasmOverrides?: Record<string, unknown>;
	logger?: LoggerLike;
}
```

| Field             | Description                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `video`           | Video element to play the camera stream in. Created lazily when omitted (requires DOM).                                                                   |
| `formats`         | Formats to detect. Fewer formats = faster decode, fewer false positives.                                                                                  |
| `mode`            | `"single"` — auto-stop after first detection; `"continuous"` — keep scanning, dedupe within `dedupeMs`.                                                   |
| `onScan`          | Called for every successful detection.                                                                                                                    |
| `onError`         | Called whenever an error is set on the state.                                                                                                             |
| `preferredCamera` | `"environment"` / `"user"` facing hint (via `facingMode: { ideal }`), or a concrete `deviceId` (via `deviceId: { exact }`).                               |
| `scanIntervalMs`  | Minimal interval between decode attempts in ms (clamped to `>= 0`).                                                                                       |
| `dedupeMs`        | Continuous mode: suppress repeated detections of the identical value within this window (clamped to `>= 0`).                                              |
| `adapter`         | Camera acquisition seam. Default wraps `navigator.mediaDevices`.                                                                                          |
| `detector`        | Decoding engine seam. Default wraps the `barcode-detector` ponyfill (created lazily on first `start()`; when set, `formats`/`wasmOverrides` are ignored). |
| `wasmOverrides`   | Passed to zxing-wasm's `prepareZXingModule` — most notably `locateFile` for self-hosting the `.wasm` (CSP-strict or offline apps).                        |
| `logger`          | Custom logger (`@marianmeres/clog` compatible). Default `createClog("scanner")`.                                                                          |

### `Scanner`

```typescript
interface Scanner {
	subscribe(cb: (state: ScannerState) => void): () => void;
	get(): ScannerState;
	start(): Promise<ScanResult | null>;
	stop(): void;
	listCameras(): Promise<CameraInfo[]>;
	setCamera(deviceId: string): Promise<void>;
	setTorch(on: boolean): Promise<boolean>;
	getVideo(): HTMLVideoElement | null;
	destroy(): void;
}
```

### `ScannerState`

```typescript
interface ScannerState {
	status: ScannerStatus;
	error: ScannerError | null;
	permission: CameraPermissionStatus;
	torch: { supported: boolean; on: boolean };
	cameras: CameraInfo[];
	activeCameraId: string | null;
	lastResult: ScanResult | null;
}
```

| Field            | Description                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `status`         | `"idle"` → `"initializing"` → `"scanning"` → `"stopped"` (back to `"idle"` on failed start)              |
| `error`          | Last error, or `null`. Methods never throw — errors land here. Cleared on each `start()`.                |
| `permission`     | Camera permission, best effort (Permissions API where available, otherwise from `getUserMedia` outcomes) |
| `torch`          | Torch capability + current state of the active track                                                     |
| `cameras`        | Populated on `listCameras()` and after successful `start()` (labels require permission)                  |
| `activeCameraId` | Device id of the currently active camera, or `null`                                                      |
| `lastResult`     | Most recent successful detection, or `null`. Cleared on each `start()`.                                  |

### `ScanResult`

```typescript
interface ScanResult {
	value: string; // decoded payload
	format: BarcodeFormat; // e.g. "qr_code"
	cornerPoints: Point2D[]; // corners in source coordinates
	boundingBox: DOMRectReadOnly; // bounding box in source coordinates
	timestamp: number; // Date.now()
}
```

### `ScannerError`

```typescript
interface ScannerError {
	code: ScannerErrorCode;
	message: string;
}
```

### `ScannerStatus`

```typescript
type ScannerStatus = "idle" | "initializing" | "scanning" | "stopped";
```

### `ScanMode`

```typescript
type ScanMode = "single" | "continuous";
```

### `CameraPermissionStatus`

```typescript
type CameraPermissionStatus = "unknown" | "prompt" | "granted" | "denied";
```

### `CameraFacing`

```typescript
type CameraFacing = "user" | "environment";
```

### `CameraInfo`

```typescript
interface CameraInfo {
	deviceId: string; // usable with scanner.setCamera()
	label: string; // empty until permission has been granted at least once
	facing: CameraFacing | null; // best-effort, derived from the label
}
```

### `BarcodeFormat`

Formats supported by the underlying zxing-cpp engine. The special values
`"linear_codes"`, `"matrix_codes"` and `"any"` are engine-level shortcuts expanding to
the respective format groups. The type is open (`string`-compatible) for
forward-compat while keeping autocomplete on the known values.

```typescript
type BarcodeFormat =
	| "aztec"
	| "codabar"
	| "code_39"
	| "code_93"
	| "code_128"
	| "data_matrix"
	| "databar"
	| "databar_expanded"
	| "databar_limited"
	| "dx_film_edge"
	| "ean_8"
	| "ean_13"
	| "itf"
	| "maxi_code"
	| "micro_qr_code"
	| "pdf417"
	| "qr_code"
	| "rm_qr_code"
	| "upc_a"
	| "upc_e"
	| "linear_codes"
	| "matrix_codes"
	| "any"
	| (string & Record<never, never>);
```

### `Point2D`

```typescript
interface Point2D {
	x: number;
	y: number;
}
```

### `Detector`

Abstraction over the barcode decoding engine — shaped like the W3C `BarcodeDetector`.
Injectable via `ScannerConfig.detector` for testing or engine swaps.

```typescript
interface Detector {
	detect(source: DetectorSource): Promise<DetectedBarcodeLike[]>;
}
```

### `DetectorSource`

```typescript
type DetectorSource =
	| HTMLVideoElement
	| HTMLImageElement
	| HTMLCanvasElement
	| ImageBitmap
	| ImageData
	| Blob;
```

### `DetectedBarcodeLike`

The raw detection shape produced by a `Detector` — structurally compatible with the
W3C `DetectedBarcode`.

```typescript
interface DetectedBarcodeLike {
	rawValue: string;
	format: string;
	cornerPoints: Point2D[];
	boundingBox: DOMRectReadOnly;
}
```

### `CameraAdapter`

Abstraction over camera acquisition. Injectable via `ScannerConfig.adapter` for
testing or replacement. The default implementation
([`createDefaultCameraAdapter`](#createdefaultcameraadapteroptions)) wraps
`navigator.mediaDevices` for streams/enumeration and delegates the permission
lifecycle to `@marianmeres/mediaperms`.

NOTE (difference vs mediaperms): the scanner RETAINS the acquired stream for the live
preview — the adapter must return a live `MediaStream`, the scanner is responsible for
stopping its tracks.

```typescript
interface CameraAdapter {
	getStream(constraints: MediaStreamConstraints): Promise<MediaStream>;
	enumerateVideoDevices(): Promise<CameraInfo[]>;
	queryPermission(): Promise<CameraPermissionStatus | null>;
	onPermissionChange(
		cb: (status: CameraPermissionStatus) => void,
	): (() => void) | null;
	destroy?(): void;
}
```

| Method                    | Description                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `getStream(constraints)`  | Acquire a camera stream. May prompt. Rejections are classified by the scanner.                                  |
| `enumerateVideoDevices()` | List available video input devices.                                                                             |
| `queryPermission()`       | Query camera permission without prompting. Return `null` when undeterminable.                                   |
| `onPermissionChange(cb)`  | Subscribe to permission changes. Return unsubscribe fn, or `null` when not supported.                           |
| `destroy()` (optional)    | Release adapter-owned resources. Called by `Scanner.destroy()` ONLY for the adapter the scanner created itself. |

### `LoggerLike`

Logger shape (`@marianmeres/clog` compatible; `console` also satisfies it).

```typescript
interface LoggerLike {
	(...args: any[]): any;
	debug: (...args: any[]) => any;
	warn: (...args: any[]) => any;
	error: (...args: any[]) => any;
}
```

### `CreateDefaultDetectorOptions`

```typescript
interface CreateDefaultDetectorOptions {
	formats?: BarcodeFormat[]; // default ["qr_code"]
	wasmOverrides?: Record<string, unknown>;
}
```

### `ScanImageOptions`

```typescript
interface ScanImageOptions {
	formats?: BarcodeFormat[]; // default ["qr_code"]
	detector?: Detector;
	wasmOverrides?: Record<string, unknown>;
}
```

---

## Constants

### `ScannerErrorCode`

Machine-readable error codes attached to `ScannerState.error.code`.

```typescript
const ScannerErrorCode = {
	NoDevice: "NO_DEVICE",
	InsecureContext: "INSECURE_CONTEXT",
	DeviceBusy: "DEVICE_BUSY",
	PermissionDenied: "PERMISSION_DENIED",
	RequestFailed: "REQUEST_FAILED",
	NotSupported: "NOT_SUPPORTED",
	DetectorFailed: "DETECTOR_FAILED",
} as const;

type ScannerErrorCode = typeof ScannerErrorCode[keyof typeof ScannerErrorCode];
```

| Code                | Cause                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `NO_DEVICE`         | `getUserMedia` threw `NotFoundError` / `DevicesNotFoundError` — no camera available                                   |
| `INSECURE_CONTEXT`  | `getUserMedia` threw `SecurityError` — origin not secure (camera requires HTTPS) or Permissions-Policy blocks it      |
| `DEVICE_BUSY`       | `getUserMedia` threw `NotReadableError` / `TrackStartError` — hardware held by another consumer                       |
| `PERMISSION_DENIED` | Camera access denied by the user or platform policy (`NotAllowedError`) — `state.permission` is set to `"denied"` too |
| `REQUEST_FAILED`    | Camera acquisition failed with a non-classified error, or the live camera track ended unexpectedly                    |
| `NOT_SUPPORTED`     | Required platform API is missing (no `mediaDevices`, no DOM for the video element, …)                                 |
| `DETECTOR_FAILED`   | The barcode detector threw repeatedly (5 consecutive failures stop the scan) or failed to construct                   |

### `DEFAULT_FORMATS`

`["qr_code"]` — Default formats (QR only — the fastest and the primary use case).

---

## Stage (`@marianmeres/scanner/stage`)

### `createScannerStage(scanner, options)`

Mount the scanning stage UI into `options.container`: the scanner's cover-fit
`<video>` preview, a dimmed overlay with a rounded viewfinder cutout + corner guides,
an optional animated scan line (`prefers-reduced-motion` honored), a brief success
flash on detection, and opt-in control buttons. One scoped `<style>` element is
injected into `document.head` (once, id `mms-styles`).

The stage is a pure consumer of the headless `Scanner` — destroying the stage does
NOT stop or destroy the scanner (and vice versa).

Unlike the scanner methods, this factory **throws**: when called without a DOM
(`document` undefined), without `options.container`, or when the scanner cannot
provide a video element.

**Parameters:**

- `scanner` (`Scanner`) — The headless scanner instance (its `getVideo()` element is
  rendered).
- `options` (`ScannerStageOptions`)

| Field       | Type                                                            | Description                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `container` | `HTMLElement` — **required**                                    | Element to mount the stage into (its `position` is set to `relative` when unset).                                                                                                 |
| `controls`  | `{ cancel?: boolean; torch?: boolean; cameraSwitch?: boolean }` | Which built-in buttons to render. Default `{ cancel: true }`. Buttons for unsupported features hide automatically (torch without capability, camera switch with a single camera). |
| `scanLine`  | `boolean` — default `true`                                      | Render the animated scan line inside the viewfinder.                                                                                                                              |
| `theme`     | `"auto" \| "light" \| "dark"` — default `"auto"`                | `"auto"` follows `prefers-color-scheme` (live).                                                                                                                                   |
| `accent`    | `string` — optional                                             | Accent color (any CSS color value) — sets `--mms-accent`.                                                                                                                         |
| `onCancel`  | `() => void` — optional                                         | Called after the built-in cancel button stopped the scanner.                                                                                                                      |

**Returns:** `ScannerStage`

```typescript
interface ScannerStage {
	el: HTMLElement; // the stage root (already mounted into the container)
	destroy(): void; // unmount + release stage resources; does NOT touch the scanner
}
```

**Example:**

```typescript
import { createScanner } from "@marianmeres/scanner";
import { createScannerStage } from "@marianmeres/scanner/stage";

const scanner = createScanner();
const stage = createScannerStage(scanner, {
	container: document.getElementById("scan")!,
	controls: { cancel: true, torch: true, cameraSwitch: true },
	accent: "#e11d48",
	onCancel: () => console.log("cancelled"),
});

const result = await scanner.start();
stage.destroy();
scanner.destroy();
```

### `ScannerStageTheme`

```typescript
type ScannerStageTheme = "auto" | "light" | "dark";
```

### Stage theming (CSS custom properties)

Scoped to the `.mms-stage` root — override on the container or via a stylesheet:

| Variable             | Default                    | Purpose                           |
| -------------------- | -------------------------- | --------------------------------- |
| `--mms-accent`       | `#3b82f6`                  | Scan line + active torch button   |
| `--mms-success`      | `#22c55e`                  | Detection success flash           |
| `--mms-dim`          | `rgba(0, 0, 0, 0.55)`      | Overlay dim around the viewfinder |
| `--mms-corner-color` | `rgba(255, 255, 255, 0.9)` | Corner guide color                |
| `--mms-corner-size`  | `26px`                     | Corner guide length               |
| `--mms-corner-width` | `4px`                      | Corner guide stroke width         |
| `--mms-frame-size`   | `min(65%, 65vmin)`         | Viewfinder size                   |
| `--mms-radius`       | `0`                        | Stage border radius               |
| `--mms-btn-bg`       | theme-dependent            | Control button background         |
| `--mms-btn-fg`       | theme-dependent            | Control button foreground         |
