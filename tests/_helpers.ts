// deno-lint-ignore-file no-explicit-any
/**
 * Shared test doubles for the headless scanner core. No real browser APIs —
 * everything platform-touching is injected via the `CameraAdapter` and
 * `Detector` seams (micperms test blueprint).
 */
import type {
	CameraAdapter,
	CameraInfo,
	CameraPermissionStatus,
	DetectedBarcodeLike,
	Detector,
	LoggerLike,
} from "../src/types.ts";

export const _g = globalThis as any;

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/** Clog-compatible logger that records calls instead of printing. */
export interface RecordingLogger extends LoggerLike {
	debugs: unknown[][];
	warns: unknown[][];
	errors: unknown[][];
}

export function createRecordingLogger(): RecordingLogger {
	const logger: any = (...args: unknown[]) => args;
	logger.debugs = [];
	logger.warns = [];
	logger.errors = [];
	logger.debug = (...args: unknown[]) => logger.debugs.push(args);
	logger.warn = (...args: unknown[]) => logger.warns.push(args);
	logger.error = (...args: unknown[]) => logger.errors.push(args);
	return logger as RecordingLogger;
}

// ---------------------------------------------------------------------------
// Fake MediaStream / MediaStreamTrack
// ---------------------------------------------------------------------------

export interface FakeTrackOptions {
	deviceId?: string;
	/** `getCapabilities()` return value (e.g. `{ torch: true }`). Default `{}`. */
	capabilities?: Record<string, unknown>;
	/** Make `applyConstraints()` reject with this error. */
	applyConstraintsError?: Error;
}

export interface FakeTrack {
	kind: "video";
	stopCalls: number;
	appliedConstraints: unknown[];
	stop(): void;
	getSettings(): { deviceId?: string };
	getCapabilities(): Record<string, unknown>;
	applyConstraints(constraints: unknown): Promise<void>;
}

export function createFakeTrack(options: FakeTrackOptions = {}): FakeTrack {
	const track: FakeTrack = {
		kind: "video",
		stopCalls: 0,
		appliedConstraints: [],
		stop() {
			track.stopCalls++;
		},
		getSettings: () => ({ deviceId: options.deviceId ?? "mock-camera-1" }),
		getCapabilities: () => options.capabilities ?? {},
		applyConstraints(constraints: unknown) {
			if (options.applyConstraintsError) {
				return Promise.reject(options.applyConstraintsError);
			}
			track.appliedConstraints.push(constraints);
			return Promise.resolve();
		},
	};
	return track;
}

export function createFakeStream(
	track: FakeTrack = createFakeTrack(),
): { stream: MediaStream; track: FakeTrack } {
	const stream = {
		getTracks: () => [track],
		getVideoTracks: () => [track],
	} as unknown as MediaStream;
	return { stream, track };
}

// ---------------------------------------------------------------------------
// Mock CameraAdapter
// ---------------------------------------------------------------------------

export interface MockAdapterOptions {
	/** Custom stream factory (per call). Default: fresh fake stream every call. */
	getStream?: (
		constraints: MediaStreamConstraints,
		callIndex: number,
	) => Promise<MediaStream>;
	cameras?: CameraInfo[];
	/** `queryPermission()` result. Default `null` (Permissions API unsupported). */
	queryResult?: CameraPermissionStatus | null;
	/** Make `onPermissionChange` return an unsubscribe fn (default: `null`). */
	supportsPermissionChange?: boolean;
}

export interface MockAdapter extends CameraAdapter {
	getStreamCalls: MediaStreamConstraints[];
	permissionChangeCb: ((status: CameraPermissionStatus) => void) | null;
	unsubscribeCalls: number;
}

export function createMockAdapter(options: MockAdapterOptions = {}): MockAdapter {
	const adapter: MockAdapter = {
		getStreamCalls: [],
		permissionChangeCb: null,
		unsubscribeCalls: 0,
		getStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
			const idx = adapter.getStreamCalls.length;
			adapter.getStreamCalls.push(constraints);
			if (options.getStream) return options.getStream(constraints, idx);
			return Promise.resolve(createFakeStream().stream);
		},
		enumerateVideoDevices: () => Promise.resolve(options.cameras ?? []),
		queryPermission: () => Promise.resolve(options.queryResult ?? null),
		onPermissionChange(cb) {
			if (!options.supportsPermissionChange) return null;
			adapter.permissionChangeCb = cb;
			return () => {
				adapter.unsubscribeCalls++;
			};
		},
	};
	return adapter;
}

// ---------------------------------------------------------------------------
// Mock Detector
// ---------------------------------------------------------------------------

export interface MockDetector extends Detector {
	detectCalls: number;
	lastSource: unknown;
	/** Every subsequent `detect()` resolves with these. */
	setResults(results: DetectedBarcodeLike[]): void;
	/** Full control per call (index-based); overrides `setResults`. */
	setDetectFn(fn: (callIndex: number) => Promise<DetectedBarcodeLike[]>): void;
}

export function createMockDetector(
	initial: DetectedBarcodeLike[] = [],
): MockDetector {
	let results = initial;
	let fn: ((callIndex: number) => Promise<DetectedBarcodeLike[]>) | null = null;
	const detector: MockDetector = {
		detectCalls: 0,
		lastSource: null,
		detect(source) {
			const idx = detector.detectCalls++;
			detector.lastSource = source;
			if (fn) return fn(idx);
			return Promise.resolve(results);
		},
		setResults(r) {
			results = r;
		},
		setDetectFn(f) {
			fn = f;
		},
	};
	return detector;
}

export function makeDetection(
	value: string,
	format = "qr_code",
): DetectedBarcodeLike {
	return {
		rawValue: value,
		format,
		cornerPoints: [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		],
		boundingBox: new DOMRect(0, 0, 10, 10) as DOMRectReadOnly,
	};
}

// ---------------------------------------------------------------------------
// Stub video element (plain object — the loop only reads readyState/videoWidth)
// ---------------------------------------------------------------------------

export interface StubVideo {
	readyState: number;
	videoWidth: number;
	videoHeight: number;
	muted: boolean;
	autoplay: boolean;
	srcObject: unknown;
	playCalls: number;
	setAttribute(name: string, value: string): void;
	play(): Promise<void>;
}

export function createStubVideo(): StubVideo {
	const video: StubVideo = {
		readyState: 4, // HAVE_ENOUGH_DATA
		videoWidth: 640,
		videoHeight: 480,
		muted: false,
		autoplay: false,
		srcObject: null,
		playCalls: 0,
		setAttribute() {},
		play() {
			video.playCalls++;
			return Promise.resolve();
		},
	};
	return video;
}

export function asVideoEl(video: StubVideo): HTMLVideoElement {
	return video as unknown as HTMLVideoElement;
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitMicrotasks(n = 3): Promise<void> {
	for (let i = 0; i < n; i++) await Promise.resolve();
}

export async function waitFor(
	cond: () => boolean,
	timeoutMs = 3000,
	stepMs = 5,
): Promise<void> {
	const t0 = Date.now();
	while (!cond()) {
		if (Date.now() - t0 > timeoutMs) {
			throw new Error("waitFor: condition not met in time");
		}
		await sleep(stepMs);
	}
}
