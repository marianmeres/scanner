// deno-lint-ignore-file no-explicit-any
import { createClog } from "@marianmeres/clog";
import { createStore } from "@marianmeres/store";
import { createDefaultCameraAdapter } from "./camera-adapter.ts";
import { createDefaultDetector, toScanResult } from "./detector.ts";
import type {
	CameraInfo,
	Detector,
	LoggerLike,
	ScanMode,
	Scanner,
	ScannerConfig,
	ScannerError,
	ScannerState,
	ScannerStatus,
	ScanResult,
} from "./types.ts";
import { ScannerErrorCode } from "./types.ts";

const _g: any = globalThis;

const DEFAULT_SCAN_INTERVAL_MS = 100;
const DEFAULT_DEDUPE_MS = 1500;
/** Stop scanning after this many consecutive detector failures. */
const MAX_DETECT_FAILURES = 5;

/** Classify a getUserMedia (or adapter) rejection into a {@linkcode ScannerError}. */
export function classifyAcquireError(e: unknown): ScannerError {
	const name = (e as any)?.name ?? "";
	const message = (e as any)?.message || String(e);
	switch (name) {
		case "NotFoundError":
		case "DevicesNotFoundError":
			return { code: ScannerErrorCode.NoDevice, message };
		case "SecurityError":
			return { code: ScannerErrorCode.InsecureContext, message };
		case "NotReadableError":
		case "TrackStartError":
			return { code: ScannerErrorCode.DeviceBusy, message };
		case "NotSupportedError":
			return { code: ScannerErrorCode.NotSupported, message };
		default:
			return { code: ScannerErrorCode.RequestFailed, message };
	}
}

function isPermissionDenied(e: unknown): boolean {
	const name = (e as any)?.name ?? "";
	return name === "NotAllowedError" || name === "PermissionDeniedError";
}

/**
 * Create a headless (no UI) camera barcode scanner.
 *
 * Reactive state is exposed via the svelte-store-compatible
 * `subscribe`/`get`. Methods never throw — errors land in `state.error`
 * (see {@linkcode ScannerErrorCode}).
 *
 * ```ts
 * const scanner = createScanner({ onScan: (r) => console.log(r.value) });
 * const result = await scanner.start(); // single-shot: auto-stops on first hit
 * scanner.destroy();
 * ```
 */
export function createScanner(config: ScannerConfig = {}): Scanner {
	const logger: LoggerLike = config.logger ?? (createClog("scanner") as LoggerLike);
	const ownsAdapter = !config.adapter;
	const adapter = config.adapter ?? createDefaultCameraAdapter();
	const mode: ScanMode = config.mode ?? "single";
	const scanIntervalMs = Math.max(0, config.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS);
	const dedupeMs = Math.max(0, config.dedupeMs ?? DEFAULT_DEDUPE_MS);

	const store = createStore<ScannerState>({
		status: "idle",
		error: null,
		permission: "unknown",
		torch: { supported: false, on: false },
		cameras: [],
		activeCameraId: null,
		lastResult: null,
	});

	let detector: Detector | null = config.detector ?? null;
	let video: HTMLVideoElement | null = config.video ?? null;
	let stream: MediaStream | null = null;

	let destroyed = false;
	/** Detection loop is running. */
	let active = false;
	/** Temporarily suspend detection (e.g. during live camera switch). */
	let paused = false;
	/** Invalidates in-flight async init when start/stop interleave. */
	let generation = 0;

	let startPromise: Promise<ScanResult | null> | null = null;
	let resolveStart: ((r: ScanResult | null) => void) | null = null;

	let frameCancel: (() => void) | null = null;
	let lastDetectAt = 0;
	let consecutiveFailures = 0;
	/** Continuous mode dedupe: `format|value` -> last emit timestamp. */
	const seen = new Map<string, number>();
	/** Explicit camera override (set via setCamera). */
	let overrideDeviceId: string | null = null;
	/** Serializes live camera switches (concurrent setCamera calls chain). */
	let switchChain: Promise<void> = Promise.resolve();
	/** Delayed torch-capability re-probe (Android Chrome quirk). */
	let torchProbeTimer: ReturnType<typeof setTimeout> | null = null;
	/** Detaches the current track "ended" watcher. */
	let trackEndedCleanup: (() => void) | null = null;

	const cleanups: (() => void)[] = [];

	// -----------------------------------------------------------------------
	// State helpers
	// -----------------------------------------------------------------------

	function update(patch: Partial<ScannerState>): void {
		store.update((s) => ({ ...s, ...patch }));
	}

	function setError(error: ScannerError): void {
		logger.warn(`[${error.code}]`, error.message);
		update({ error });
		try {
			config.onError?.(error);
		} catch (e) {
			logger.error("onError callback threw", e);
		}
	}

	/** Classify + report a camera acquisition failure (start or live switch). */
	function reportAcquireError(e: unknown): void {
		if (isPermissionDenied(e)) {
			update({ permission: "denied" });
			setError({
				code: ScannerErrorCode.PermissionDenied,
				message: (e as any)?.message || "Camera permission denied",
			});
		} else {
			setError(classifyAcquireError(e));
		}
	}

	function safeOnScan(result: ScanResult): void {
		try {
			config.onScan?.(result);
		} catch (e) {
			logger.error("onScan callback threw", e);
		}
	}

	// -----------------------------------------------------------------------
	// Video element
	// -----------------------------------------------------------------------

	function prepVideoEl(v: HTMLVideoElement): void {
		try {
			v.muted = true;
			v.autoplay = true;
			(v as any).playsInline = true;
			v.setAttribute?.("playsinline", "");
			v.setAttribute?.("muted", "");
			v.setAttribute?.("autoplay", "");
		} catch (e) {
			logger.debug("prepVideoEl", e);
		}
	}

	function getVideo(): HTMLVideoElement | null {
		if (video) return video;
		if (!_g?.document?.createElement) return null;
		video = _g.document.createElement("video") as HTMLVideoElement;
		prepVideoEl(video);
		return video;
	}

	function videoReady(v: HTMLVideoElement): boolean {
		// HAVE_CURRENT_DATA (2)+ and a real frame size
		return ((v.readyState as number) ?? 0) >= 2 &&
			((v.videoWidth as number) ?? 0) > 0;
	}

	// -----------------------------------------------------------------------
	// Detection loop
	// -----------------------------------------------------------------------

	function scheduleFrame(v: HTMLVideoElement, fn: () => void): () => void {
		const anyV = v as any;
		if (typeof anyV.requestVideoFrameCallback === "function") {
			const id = anyV.requestVideoFrameCallback(() => fn());
			return () => anyV.cancelVideoFrameCallback?.(id);
		}
		if (typeof _g.requestAnimationFrame === "function") {
			const id = _g.requestAnimationFrame(() => fn());
			return () => _g.cancelAnimationFrame?.(id);
		}
		const id = setTimeout(fn, Math.max(scanIntervalMs, 16));
		return () => clearTimeout(id);
	}

	function loop(): void {
		if (!active || destroyed || !video) return;
		const gen = generation;
		frameCancel = scheduleFrame(video, () => void onFrame(gen));
	}

	async function onFrame(gen: number): Promise<void> {
		if (gen !== generation || !active || destroyed || !video) return;
		const now = Date.now();
		const hidden = _g?.document?.visibilityState === "hidden";
		if (
			!hidden && !paused && now - lastDetectAt >= scanIntervalMs &&
			videoReady(video)
		) {
			lastDetectAt = now;
			try {
				const detections = await detector!.detect(video);
				// the session may have been stopped/replaced while decoding —
				// a stale frame must not touch the new session (results,
				// counters, nor fork a second frame chain via the trailing loop)
				if (gen !== generation || !active || destroyed) return;
				consecutiveFailures = 0;
				if (detections?.length) {
					handleDetections(detections.map((d) => toScanResult(d)));
					if (!active) return; // single-shot finished
				}
			} catch (e) {
				if (gen !== generation || destroyed) return;
				consecutiveFailures++;
				logger.debug("detect failed", e);
				if (consecutiveFailures >= MAX_DETECT_FAILURES) {
					setError({
						code: ScannerErrorCode.DetectorFailed,
						message: (e as any)?.message || String(e),
					});
					stopWith(null, "stopped");
					return;
				}
			}
		}
		loop();
	}

	function handleDetections(results: ScanResult[]): void {
		if (mode === "single") {
			const result = results[0];
			update({ lastResult: result });
			safeOnScan(result);
			stopWith(result, "stopped");
			return;
		}
		// continuous
		for (const result of results) {
			const key = `${result.format}|${result.value}`;
			const last = seen.get(key) ?? 0;
			if (result.timestamp - last < dedupeMs) continue;
			seen.set(key, result.timestamp);
			update({ lastResult: result });
			safeOnScan(result);
		}
		// opportunistic prune — expired entries can never suppress again, and a
		// long-lived session over unique codes would otherwise grow unbounded
		if (seen.size > 64) {
			const now = Date.now();
			for (const [key, ts] of seen) {
				if (now - ts >= dedupeMs) seen.delete(key);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Start / stop
	// -----------------------------------------------------------------------

	function buildConstraints(): MediaStreamConstraints {
		const cam = overrideDeviceId ?? config.preferredCamera ?? "environment";
		const videoC: MediaTrackConstraints = cam === "environment" || cam === "user"
			? { facingMode: { ideal: cam } }
			: { deviceId: { exact: cam } };
		return { video: videoC, audio: false };
	}

	function adoptStream(s: MediaStream): void {
		stream = s;
		const track = s.getVideoTracks?.()[0];
		const settings = track?.getSettings?.();
		const caps = (track as any)?.getCapabilities?.();
		update({
			activeCameraId: settings?.deviceId ?? null,
			torch: { supported: !!caps?.torch, on: false },
		});
	}

	/**
	 * Android Chrome reports track capabilities (notably `torch`) only after
	 * the camera actually streams — re-probe shortly after adoption so
	 * `state.torch.supported` does not stay a stale `false`.
	 */
	function scheduleTorchReprobe(track: any, gen: number): void {
		if (typeof track?.getCapabilities !== "function") return;
		if (torchProbeTimer) clearTimeout(torchProbeTimer);
		torchProbeTimer = setTimeout(() => {
			torchProbeTimer = null;
			if (gen !== generation || destroyed) return;
			try {
				const caps = track.getCapabilities?.();
				if (caps?.torch && !store.get().torch.supported) {
					store.update((s) => ({
						...s,
						torch: { ...s.torch, supported: true },
					}));
				}
			} catch (_e) {
				/* noop */
			}
		}, 500);
	}

	/**
	 * The OS/browser can kill the camera track outside our control (permission
	 * revoked mid-scan, USB camera unplugged, native app preempting the
	 * camera). Without this the scanner would hang in "scanning" forever.
	 */
	function watchTrackEnded(track: any, gen: number): void {
		trackEndedCleanup?.();
		trackEndedCleanup = null;
		if (typeof track?.addEventListener !== "function") return;
		const onEnded = (): void => {
			if (gen !== generation || destroyed) return;
			setError({
				code: ScannerErrorCode.RequestFailed,
				message: "Camera track ended unexpectedly " +
					"(permission revoked, device unplugged or preempted)",
			});
			stopWith(null, "stopped");
		};
		track.addEventListener("ended", onEnded);
		trackEndedCleanup = () => track.removeEventListener?.("ended", onEnded);
	}

	async function playStream(s: MediaStream): Promise<void> {
		if (!video) return;
		try {
			(video as any).srcObject = s;
			await (video as any).play?.();
		} catch (e) {
			// autoplay/gesture quirks — the stream is still attached; log only
			logger.debug("video.play()", e);
		}
	}

	async function refreshCameras(): Promise<CameraInfo[]> {
		if (destroyed) return [];
		try {
			const cameras = await adapter.enumerateVideoDevices();
			if (!destroyed) update({ cameras });
			return cameras;
		} catch (e) {
			logger.debug("enumerateVideoDevices failed", e);
			return [];
		}
	}

	async function init(gen: number): Promise<void> {
		update({ status: "initializing", error: null, lastResult: null });

		// lazy detector (wasm cost only when actually used)
		if (!detector) {
			try {
				detector = createDefaultDetector({
					formats: config.formats,
					wasmOverrides: config.wasmOverrides,
				});
			} catch (e) {
				setError({
					code: ScannerErrorCode.DetectorFailed,
					message: (e as any)?.message || String(e),
				});
				finishStart(null, "idle");
				return;
			}
		}

		if (!getVideo()) {
			setError({
				code: ScannerErrorCode.NotSupported,
				message: "No DOM available to create a video element " +
					"(pass config.video explicitly)",
			});
			finishStart(null, "idle");
			return;
		}

		let s: MediaStream;
		try {
			s = await adapter.getStream(buildConstraints());
		} catch (e) {
			// stopped/destroyed while waiting — the cancelling stopWith()/destroy()
			// already resolved the (old) promise and set the final status; this
			// rejection belongs to a request nobody is waiting for anymore
			if (gen !== generation || destroyed) return;
			reportAcquireError(e);
			finishStart(null, "idle");
			return;
		}

		if (gen !== generation || destroyed) {
			// stopped/destroyed while waiting for the stream
			s.getTracks?.().forEach((t) => t.stop());
			return;
		}

		update({ permission: "granted" });
		adoptStream(s);
		await playStream(s);

		if (gen !== generation || destroyed) return;

		const track = s.getVideoTracks?.()[0];
		watchTrackEnded(track, gen);
		scheduleTorchReprobe(track, gen);

		lastDetectAt = 0;
		consecutiveFailures = 0;
		seen.clear();
		active = true;
		update({ status: "scanning" });
		void refreshCameras(); // labels are available now — fire and forget
		loop();
	}

	/** Resolve the pending start() promise and set a final status (no stream teardown). */
	function finishStart(result: ScanResult | null, status: ScannerStatus): void {
		update({ status });
		const resolve = resolveStart;
		resolveStart = null;
		startPromise = null;
		resolve?.(result);
	}

	/** Full teardown: loop, tracks, video binding + resolve pending start(). */
	function stopWith(result: ScanResult | null, status: ScannerStatus): void {
		generation++;
		active = false;
		paused = false;
		frameCancel?.();
		frameCancel = null;
		trackEndedCleanup?.();
		trackEndedCleanup = null;
		if (torchProbeTimer) {
			clearTimeout(torchProbeTimer);
			torchProbeTimer = null;
		}
		try {
			stream?.getTracks?.().forEach((t) => t.stop());
		} catch (e) {
			logger.debug("track stop", e);
		}
		stream = null;
		if (video) {
			try {
				(video as any).srcObject = null;
			} catch (_e) {
				/* noop */
			}
		}
		store.update((s) => ({ ...s, torch: { ...s.torch, on: false } }));
		finishStart(result, status);
	}

	// -----------------------------------------------------------------------
	// Public api
	// -----------------------------------------------------------------------

	function start(): Promise<ScanResult | null> {
		if (destroyed) {
			logger.warn("start() called on destroyed scanner");
			return Promise.resolve(null);
		}
		if (startPromise) return startPromise;
		startPromise = new Promise<ScanResult | null>((resolve) => {
			resolveStart = resolve;
		});
		const p = startPromise;
		void init(++generation);
		return p;
	}

	function stop(): void {
		if (destroyed) return;
		if (!startPromise && !active && !stream) return;
		stopWith(null, "stopped");
	}

	function setCamera(deviceId: string): Promise<void> {
		if (destroyed) return Promise.resolve();
		overrideDeviceId = deviceId;
		// serialize live switches — a second call issued mid-switch would
		// otherwise see `stream === null` and silently no-op on the wrong camera
		switchChain = switchChain.then(() => doSwitchCamera(deviceId));
		return switchChain;
	}

	async function doSwitchCamera(deviceId: string): Promise<void> {
		if (destroyed || !stream) return; // not scanning: applied on next start()
		if (store.get().activeCameraId === deviceId) return; // already live
		const gen = generation;
		paused = true;
		try {
			// most mobile browsers cannot open two cameras at once — release first
			stream.getTracks?.().forEach((t) => t.stop());
			stream = null;
			const s = await adapter.getStream({
				video: { deviceId: { exact: deviceId } },
				audio: false,
			});
			if (gen !== generation || destroyed || !active) {
				// session stopped/replaced while switching — not ours to adopt
				s.getTracks?.().forEach((t) => t.stop());
				return;
			}
			adoptStream(s);
			await playStream(s);
			const track = s.getVideoTracks?.()[0];
			watchTrackEnded(track, gen);
			scheduleTorchReprobe(track, gen);
		} catch (e) {
			// a stale failure must not kill the session that replaced us
			if (gen !== generation || destroyed) return;
			reportAcquireError(e);
			stopWith(null, "stopped");
		} finally {
			// only un-pause the session this switch belongs to
			if (gen === generation) paused = false;
		}
	}

	async function setTorch(on: boolean): Promise<boolean> {
		if (destroyed) return false;
		const gen = generation;
		const track = stream?.getVideoTracks?.()[0];
		const caps = (track as any)?.getCapabilities?.();
		if (!caps?.torch) return false;
		try {
			await (track as any).applyConstraints({ advanced: [{ torch: on }] });
			// the session may have been stopped while applying — the store
			// already reflects torch.off for the (now released) track
			if (gen !== generation || destroyed) return false;
			store.update((s) => ({ ...s, torch: { ...s.torch, on } }));
			return true;
		} catch (e) {
			logger.warn("setTorch failed", e);
			return false;
		}
	}

	function destroy(): void {
		if (destroyed) return;
		stopWith(null, "stopped");
		cleanups.forEach((fn) => {
			try {
				fn();
			} catch (_e) {
				/* noop */
			}
		});
		cleanups.length = 0;
		if (ownsAdapter) {
			try {
				adapter.destroy?.();
			} catch (e) {
				logger.debug("adapter destroy", e);
			}
		}
		destroyed = true;
	}

	// a consumer-provided video element gets the same treatment as an
	// internally created one (playsinline/muted/autoplay — iOS quirks)
	if (video) prepVideoEl(video);

	// -----------------------------------------------------------------------
	// Permission tracking (best effort, fire-and-forget)
	// -----------------------------------------------------------------------

	adapter.queryPermission?.()
		.then((status) => {
			if (status && !destroyed) update({ permission: status });
		})
		.catch(() => {
			/* noop */
		});

	const unsubPerm = adapter.onPermissionChange?.((status) => {
		if (!destroyed) update({ permission: status });
	});
	if (unsubPerm) cleanups.push(unsubPerm);

	return {
		subscribe: store.subscribe.bind(store),
		get: store.get.bind(store),
		start,
		stop,
		listCameras: refreshCameras,
		setCamera,
		setTorch,
		getVideo,
		destroy,
	};
}
