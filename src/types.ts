import type { Unsubscribe } from "@marianmeres/store";

/**
 * Barcode formats supported by the underlying zxing-cpp engine (via
 * `barcode-detector`). The default is `["qr_code"]` — fewer enabled formats
 * means faster per-frame decode and fewer false positives.
 *
 * The special values `"linear_codes"`, `"matrix_codes"` and `"any"` are
 * engine-level shortcuts expanding to the respective format groups.
 */
export type BarcodeFormat =
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
	// forward-compat: allow any engine-supported string without losing
	// autocomplete on the known ones
	| (string & Record<never, never>);

/** A 2D point in source-image coordinates. */
export interface Point2D {
	x: number;
	y: number;
}

/** Camera permission status (mirrors the micperms taxonomy). */
export type CameraPermissionStatus = "unknown" | "prompt" | "granted" | "denied";

/** Camera facing direction (best-effort, derived from device label). */
export type CameraFacing = "user" | "environment";

/** Info about an available video input device. */
export interface CameraInfo {
	/** Device id usable with {@linkcode Scanner.setCamera}. */
	deviceId: string;
	/**
	 * Human readable label. NOTE: browsers return empty labels until
	 * camera permission has been granted at least once.
	 */
	label: string;
	/** Best-effort facing direction derived from the label, or `null`. */
	facing: CameraFacing | null;
}

/**
 * Machine-readable error codes attached to {@linkcode ScannerState.error}.
 *
 * - `NO_DEVICE` — getUserMedia threw `NotFoundError` / `DevicesNotFoundError`.
 *   No camera is available.
 * - `INSECURE_CONTEXT` — getUserMedia threw `SecurityError`. Origin is not
 *   secure (camera requires HTTPS) or a Permissions-Policy blocks the API.
 * - `DEVICE_BUSY` — getUserMedia threw `NotReadableError` / `TrackStartError`.
 *   Hardware is held by another consumer.
 * - `PERMISSION_DENIED` — getUserMedia threw `NotAllowedError` /
 *   `PermissionDeniedError`. The user (or platform policy) denied camera
 *   access; `state.permission` is set to `"denied"` as well.
 * - `REQUEST_FAILED` — camera acquisition failed with a non-classified error,
 *   or the live camera track ended unexpectedly (permission revoked
 *   mid-scan, device unplugged, camera preempted by a native app).
 * - `NOT_SUPPORTED` — required platform API is missing (no `mediaDevices`,
 *   no DOM for the video element, ...).
 * - `DETECTOR_FAILED` — the barcode detector threw repeatedly.
 */
export const ScannerErrorCode = {
	NoDevice: "NO_DEVICE",
	InsecureContext: "INSECURE_CONTEXT",
	DeviceBusy: "DEVICE_BUSY",
	PermissionDenied: "PERMISSION_DENIED",
	RequestFailed: "REQUEST_FAILED",
	NotSupported: "NOT_SUPPORTED",
	DetectorFailed: "DETECTOR_FAILED",
} as const;
export type ScannerErrorCode = typeof ScannerErrorCode[keyof typeof ScannerErrorCode];

/** Error attached to {@linkcode ScannerState.error}. */
export interface ScannerError {
	/** Machine-readable error code. See {@linkcode ScannerErrorCode}. */
	code: ScannerErrorCode;
	/** Human-readable error message (typically forwarded from underlying API). */
	message: string;
}

/** Scanner lifecycle status. */
export type ScannerStatus = "idle" | "initializing" | "scanning" | "stopped";

/** A single successful barcode detection. */
export interface ScanResult {
	/** The decoded payload. */
	value: string;
	/** Detected barcode format (e.g. `"qr_code"`). */
	format: BarcodeFormat;
	/** Corner points of the detected symbol in source coordinates. */
	cornerPoints: Point2D[];
	/** Bounding box of the detected symbol in source coordinates. */
	boundingBox: DOMRectReadOnly;
	/** Detection timestamp (`Date.now()`). */
	timestamp: number;
}

/** Reactive state of the scanner. */
export interface ScannerState {
	/** Current lifecycle status. */
	status: ScannerStatus;
	/** Last error, or `null`. Methods never throw — errors land here. */
	error: ScannerError | null;
	/**
	 * Camera permission status, best effort (Permissions API where available,
	 * otherwise updated from getUserMedia outcomes).
	 */
	permission: CameraPermissionStatus;
	/** Torch (flashlight) capability + current state of the active track. */
	torch: { supported: boolean; on: boolean };
	/**
	 * Available cameras. Populated on {@linkcode Scanner.listCameras} and
	 * after successful {@linkcode Scanner.start} (labels require permission).
	 */
	cameras: CameraInfo[];
	/** Device id of the currently active camera, or `null`. */
	activeCameraId: string | null;
	/** Most recent successful detection, or `null`. */
	lastResult: ScanResult | null;
}

/**
 * The raw detection shape produced by a {@linkcode Detector} — structurally
 * compatible with the W3C `DetectedBarcode`.
 */
export interface DetectedBarcodeLike {
	rawValue: string;
	format: string;
	cornerPoints: Point2D[];
	boundingBox: DOMRectReadOnly;
}

/** Anything a {@linkcode Detector} can decode. */
export type DetectorSource =
	| HTMLVideoElement
	| HTMLImageElement
	| HTMLCanvasElement
	| ImageBitmap
	| ImageData
	| Blob;

/**
 * Abstraction over the barcode decoding engine — shaped like the W3C
 * `BarcodeDetector`. Injectable for testing or engine swaps. The default
 * implementation wraps the `barcode-detector` ponyfill (zxing-cpp wasm).
 */
export interface Detector {
	detect(source: DetectorSource): Promise<DetectedBarcodeLike[]>;
}

/**
 * Abstraction over camera acquisition. Injectable for testing or replacement.
 * The default implementation wraps `navigator.mediaDevices` for stream
 * acquisition/enumeration and delegates the permission lifecycle to
 * `@marianmeres/mediaperms`.
 *
 * NOTE (difference vs micperms): the scanner RETAINS the acquired stream for
 * the live preview — the adapter must return a live `MediaStream`, the
 * scanner is responsible for stopping its tracks.
 */
export interface CameraAdapter {
	/** Acquire a camera stream. May prompt. Rejections are classified by the scanner. */
	getStream(constraints: MediaStreamConstraints): Promise<MediaStream>;
	/** List available video input devices. */
	enumerateVideoDevices(): Promise<CameraInfo[]>;
	/**
	 * Query camera permission via the Permissions API without prompting.
	 * Returns `null` when the Permissions API is unavailable/unsupported.
	 */
	queryPermission(): Promise<CameraPermissionStatus | null>;
	/**
	 * Subscribe to permission changes. Returns an unsubscribe fn, or `null`
	 * when not supported.
	 */
	onPermissionChange(
		cb: (status: CameraPermissionStatus) => void,
	): (() => void) | null;
	/**
	 * Release adapter-owned resources (e.g. an internally created mediaperms
	 * instance). Called by {@linkcode Scanner.destroy} ONLY when the scanner
	 * created the adapter itself — a consumer-provided adapter is owned (and
	 * destroyed) by the consumer.
	 */
	destroy?(): void;
}

/** Scanning mode. See {@linkcode ScannerConfig.mode}. */
export type ScanMode = "single" | "continuous";

/**
 * Logger shape — method-only, so both `@marianmeres/clog` instances and the
 * plain `console` satisfy it.
 */
export interface LoggerLike {
	debug: (...args: unknown[]) => unknown;
	warn: (...args: unknown[]) => unknown;
	error: (...args: unknown[]) => unknown;
}

/** Configuration for {@linkcode createScanner}. */
export interface ScannerConfig {
	/**
	 * Video element to play the camera stream in. Created lazily when omitted
	 * (requires DOM). The shipped stage UI uses {@linkcode Scanner.getVideo}.
	 */
	video?: HTMLVideoElement;
	/** Formats to detect. Default `["qr_code"]`. */
	formats?: BarcodeFormat[];
	/**
	 * - `"single"` (default): auto-stop after the first detection, which is
	 *   passed to `onScan` and resolves the `start()` promise.
	 * - `"continuous"`: keep scanning; every detection fires `onScan`
	 *   (deduped within {@linkcode ScannerConfig.dedupeMs}); `start()`
	 *   resolves `null` when stopped.
	 */
	mode?: ScanMode;
	/** Called for every successful detection. */
	onScan?: (result: ScanResult) => void;
	/** Called whenever an error is set on the state. */
	onError?: (error: ScannerError) => void;
	/**
	 * `"environment"` (default) / `"user"` facing hint, or a concrete
	 * `deviceId`.
	 */
	preferredCamera?: CameraFacing | (string & Record<never, never>);
	/** Minimal interval between decode attempts in ms. Default `100` (~10 fps). */
	scanIntervalMs?: number;
	/**
	 * Continuous mode: suppress repeated detections of the identical value
	 * within this window (ms). Default `1500`.
	 */
	dedupeMs?: number;
	/** Camera acquisition seam. Default wraps `navigator.mediaDevices`. */
	adapter?: CameraAdapter;
	/** Decoding engine seam. Default wraps the `barcode-detector` ponyfill. */
	detector?: Detector;
	/**
	 * Overrides passed to zxing-wasm's `prepareZXingModule` — most notably
	 * `locateFile` for self-hosting the `.wasm` binary (CSP-strict or offline
	 * apps). By default the wasm is fetched lazily from the jsDelivr CDN.
	 *
	 * ```ts
	 * wasmOverrides: { locateFile: (path, prefix) => `/assets/${path}` }
	 * ```
	 */
	wasmOverrides?: Record<string, unknown>;
	/** Custom logger (`@marianmeres/clog` compatible). */
	logger?: LoggerLike;
}

/** The scanner instance created by {@linkcode createScanner}. */
export interface Scanner {
	/**
	 * Subscribe to reactive state. Svelte store contract — the callback fires
	 * immediately with the current state. Returns an idempotent unsubscribe fn
	 * that also implements `Symbol.dispose` (usable with `using`).
	 */
	subscribe(cb: (state: ScannerState) => void): Unsubscribe;
	/** Get current state snapshot. */
	get(): ScannerState;
	/**
	 * Acquire the camera and start scanning. Never rejects.
	 *
	 * - `"single"` mode: resolves with the first {@linkcode ScanResult}, or
	 *   `null` when cancelled via {@linkcode Scanner.stop} (or on failure —
	 *   check `state.error`).
	 * - `"continuous"` mode: resolves `null` when stopped.
	 *
	 * Concurrent calls while active return the same in-flight promise.
	 */
	start(): Promise<ScanResult | null>;
	/** Cancel: stop the loop, release the camera. Resolves pending `start()` with `null`. */
	stop(): void;
	/** List available cameras (also updates `state.cameras`). */
	listCameras(): Promise<CameraInfo[]>;
	/** Switch to another camera (live-switch while scanning is supported). */
	setCamera(deviceId: string): Promise<void>;
	/**
	 * Turn the torch (flashlight) on/off. Resolves `true` on success, `false`
	 * when unsupported or failed (never rejects).
	 */
	setTorch(on: boolean): Promise<boolean>;
	/**
	 * The video element used for the live preview. Lazily created when none
	 * was configured (returns `null` in non-DOM environments).
	 */
	getVideo(): HTMLVideoElement | null;
	/** Stop everything and release all resources/listeners. Idempotent. */
	destroy(): void;
}
