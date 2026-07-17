// deno-lint-ignore-file no-explicit-any
import {
	assert,
	assertEquals,
	assertNotStrictEquals,
	assertStrictEquals,
	assertStringIncludes,
} from "@std/assert";
import { classifyAcquireError, createScanner } from "../src/scanner.ts";
import type {
	CameraInfo,
	DetectedBarcodeLike,
	ScanMode,
	ScannerConfig,
	ScannerError,
	ScannerState,
	ScanResult,
} from "../src/types.ts";
import { ScannerErrorCode } from "../src/types.ts";
import {
	_g,
	asVideoEl,
	createFakeStream,
	createFakeTrack,
	createMockAdapter,
	createMockDetector,
	createRecordingLogger,
	createStubVideo,
	type FakeTrackOptions,
	makeDetection,
	type MockAdapterOptions,
	sleep,
	waitFor,
	waitMicrotasks,
} from "./_helpers.ts";

// ---------------------------------------------------------------------------
// Harness: scanner with all seams mocked (no browser APIs, real timers)
// ---------------------------------------------------------------------------

interface HarnessOptions {
	detections?: DetectedBarcodeLike[];
	mode?: ScanMode;
	dedupeMs?: number;
	adapterOptions?: MockAdapterOptions;
	trackOptions?: FakeTrackOptions;
	config?: Partial<ScannerConfig>;
}

function harness(opts: HarnessOptions = {}) {
	const logger = createRecordingLogger();
	const video = createStubVideo();
	const detector = createMockDetector(opts.detections ?? []);
	const track = createFakeTrack({ deviceId: "cam-1", ...opts.trackOptions });
	const { stream } = createFakeStream(track);
	const adapter = createMockAdapter({
		getStream: () => Promise.resolve(stream),
		...opts.adapterOptions,
	});
	const onScanCalls: ScanResult[] = [];
	const onErrorCalls: ScannerError[] = [];
	const scanner = createScanner({
		video: asVideoEl(video),
		adapter,
		detector,
		logger,
		// no rAF in Deno → the loop falls back to setTimeout; keep it tight
		scanIntervalMs: 1,
		mode: opts.mode,
		dedupeMs: opts.dedupeMs,
		onScan: (r) => onScanCalls.push(r),
		onError: (e) => onErrorCalls.push(e),
		...opts.config,
	});
	return {
		scanner,
		adapter,
		detector,
		track,
		stream,
		video,
		logger,
		onScanCalls,
		onErrorCalls,
	};
}

// ---------------------------------------------------------------------------
// Initial state + subscribe
// ---------------------------------------------------------------------------

Deno.test("initial state", () => {
	const h = harness();
	assertEquals(h.scanner.get(), {
		status: "idle",
		error: null,
		permission: "unknown",
		torch: { supported: false, on: false },
		cameras: [],
		activeCameraId: null,
		lastResult: null,
	});
	h.scanner.destroy();
});

Deno.test("subscribe() fires immediately; unsubscribe stops updates", async () => {
	const h = harness({ detections: [makeDetection("x")] });
	const states: ScannerState[] = [];
	const unsub = h.scanner.subscribe((s) => states.push(s));
	assertEquals(states.length, 1);
	assertEquals(states[0].status, "idle");
	unsub();
	const countAfterUnsub = states.length;
	await h.scanner.start();
	assertEquals(states.length, countAfterUnsub);
	h.scanner.destroy();
});

Deno.test("getVideo(): returns the configured element; null without DOM", () => {
	const h = harness();
	assertStrictEquals(h.scanner.getVideo(), asVideoEl(h.video));
	h.scanner.destroy();
	// no config.video + no DOM in Deno → null
	const scanner = createScanner({
		adapter: createMockAdapter(),
		detector: createMockDetector(),
		logger: createRecordingLogger(),
	});
	assertEquals(scanner.getVideo(), null);
	scanner.destroy();
});

// ---------------------------------------------------------------------------
// Single-shot
// ---------------------------------------------------------------------------

Deno.test("single-shot: start() resolves with the first detection and auto-stops", async () => {
	const cameras: CameraInfo[] = [
		{ deviceId: "cam-1", label: "Back Camera", facing: "environment" },
	];
	const h = harness({
		detections: [makeDetection("hello")],
		adapterOptions: { cameras },
	});
	const statuses: string[] = [];
	const unsub = h.scanner.subscribe((s) => {
		if (statuses.at(-1) !== s.status) statuses.push(s.status);
	});

	const result = await h.scanner.start();

	assert(result, "expected a ScanResult");
	assertEquals(result.value, "hello");
	assertEquals(result.format, "qr_code");
	assertEquals(result.cornerPoints, [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	]);
	assertEquals(typeof result.timestamp, "number");

	// onScan fired exactly once, with the very same result
	assertEquals(h.onScanCalls.length, 1);
	assertStrictEquals(h.onScanCalls[0], result);

	const s = h.scanner.get();
	assertEquals(s.status, "stopped");
	assertStrictEquals(s.lastResult, result);
	assertEquals(s.permission, "granted");
	assertEquals(s.activeCameraId, "cam-1");
	assertEquals(s.error, null);
	assertEquals(s.cameras, cameras); // refreshed after acquire

	// stream released, video detached, detector was fed the video element
	assertEquals(h.track.stopCalls, 1);
	assertEquals(h.video.srcObject, null);
	assertEquals(h.video.playCalls, 1);
	assertStrictEquals(h.detector.lastSource, asVideoEl(h.video));

	assertEquals(statuses, ["idle", "initializing", "scanning", "stopped"]);
	unsub();
	h.scanner.destroy();
});

Deno.test("single-shot: first detection wins when multiple codes share a frame", async () => {
	const h = harness({ detections: [makeDetection("first"), makeDetection("second")] });
	const result = await h.scanner.start();
	assertEquals(result?.value, "first");
	assertEquals(h.onScanCalls.length, 1);
	assertEquals(h.onScanCalls[0].value, "first");
	h.scanner.destroy();
});

Deno.test("single-shot: throwing onScan callback does not break resolution", async () => {
	const h = harness({
		detections: [makeDetection("x")],
		config: {
			onScan: () => {
				throw new Error("consumer bug");
			},
		},
	});
	const result = await h.scanner.start();
	assertEquals(result?.value, "x");
	assertEquals(h.scanner.get().status, "stopped");
	assertEquals(h.logger.errors.length, 1);
	assertStringIncludes(String(h.logger.errors[0][0]), "onScan");
	h.scanner.destroy();
});

Deno.test("video.play() rejection is tolerated (autoplay/gesture quirks)", async () => {
	const h = harness({ detections: [makeDetection("x")] });
	h.video.play = () => Promise.reject(new Error("play requires a user gesture"));
	const result = await h.scanner.start();
	assertEquals(result?.value, "x");
	assertEquals(h.scanner.get().error, null);
	h.scanner.destroy();
});

Deno.test("detection waits for video readiness (readyState/videoWidth gate)", async () => {
	const h = harness({ detections: [makeDetection("x")] });
	h.video.readyState = 0; // not ready yet
	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	await sleep(60); // several frame ticks
	assertEquals(h.detector.detectCalls, 0);
	h.video.readyState = 4; // frames available now
	const result = await p;
	assertEquals(result?.value, "x");
	assert(h.detector.detectCalls >= 1);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

Deno.test("stop() before any detection: start() resolves null, no onScan", async () => {
	const h = harness(); // detector always resolves []
	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertStrictEquals(h.video.srcObject, h.stream);
	await waitFor(() => h.detector.detectCalls >= 2); // the loop is really looping
	h.scanner.stop();
	assertEquals(await p, null);
	assertEquals(h.onScanCalls.length, 0);
	assertEquals(h.scanner.get().status, "stopped");
	assertEquals(h.scanner.get().error, null);
	assertEquals(h.track.stopCalls, 1);
	assertEquals(h.video.srcObject, null);
	h.scanner.destroy();
});

Deno.test("stop() while getStream is pending: late stream tracks get stopped", async () => {
	let resolveStream: (s: MediaStream) => void = () => {};
	const late = createFakeStream(createFakeTrack({ deviceId: "late-cam" }));
	const h = harness({
		adapterOptions: {
			getStream: () =>
				new Promise<MediaStream>((r) => {
					resolveStream = r;
				}),
		},
	});
	const p = h.scanner.start();
	assertEquals(h.scanner.get().status, "initializing"); // sync, pre-acquire
	h.scanner.stop();
	assertEquals(await p, null);
	assertEquals(h.scanner.get().status, "stopped");
	assertEquals(h.onScanCalls.length, 0);
	// the stream arrives AFTER stop → generation guard must release it
	resolveStream(late.stream);
	await waitMicrotasks(5);
	assertEquals(late.track.stopCalls, 1);
	// and it must not have been adopted
	assertEquals(h.scanner.get().activeCameraId, null);
	assertEquals(h.scanner.get().status, "stopped");
	assertEquals(h.detector.detectCalls, 0);
	h.scanner.destroy();
});

Deno.test("stop() when idle is a safe no-op (status not smeared)", () => {
	const h = harness();
	h.scanner.stop();
	h.scanner.stop();
	assertEquals(h.scanner.get().status, "idle");
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// Coalescing
// ---------------------------------------------------------------------------

Deno.test("concurrent start() calls coalesce into the same promise", async () => {
	const h = harness({ detections: [makeDetection("x")] });
	const p1 = h.scanner.start();
	const p2 = h.scanner.start();
	assertStrictEquals(p1, p2);
	assertEquals(h.adapter.getStreamCalls.length, 1); // single acquire
	const [r1, r2] = await Promise.all([p1, p2]);
	assertStrictEquals(r1, r2);
	assertEquals(r1?.value, "x");
	// a settled cycle does not leak into the next one
	const p3 = h.scanner.start();
	assertNotStrictEquals(p3, p1);
	h.scanner.stop();
	assertEquals(await p3, null);
	await waitMicrotasks(5);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// Continuous mode
// ---------------------------------------------------------------------------

Deno.test("continuous: identical value deduped within dedupeMs, new value fires", async () => {
	const h = harness({
		mode: "continuous",
		detections: [makeDetection("AAA")],
		dedupeMs: 60_000,
	});
	const p = h.scanner.start();
	await waitFor(() => h.onScanCalls.length >= 1);
	// let several more frames detect the same code — must stay deduped
	const callsAtFirstScan = h.detector.detectCalls;
	await waitFor(() => h.detector.detectCalls >= callsAtFirstScan + 3);
	assertEquals(h.onScanCalls.length, 1);
	assertEquals(h.onScanCalls[0].value, "AAA");
	assertEquals(h.scanner.get().status, "scanning"); // keeps running
	// a different code fires again
	h.detector.setResults([makeDetection("BBB")]);
	await waitFor(() => h.onScanCalls.length >= 2);
	assertEquals(h.onScanCalls.length, 2);
	assertEquals(h.onScanCalls[1].value, "BBB");
	assertEquals(h.scanner.get().lastResult?.value, "BBB");
	// continuous start() resolves null on stop
	h.scanner.stop();
	assertEquals(await p, null);
	assertEquals(h.scanner.get().status, "stopped");
	assertEquals(h.track.stopCalls, 1);
	h.scanner.destroy();
});

Deno.test("continuous: dedupeMs 0 disables dedupe (same code fires repeatedly)", async () => {
	const h = harness({
		mode: "continuous",
		detections: [makeDetection("AAA")],
		dedupeMs: 0,
	});
	const p = h.scanner.start();
	await waitFor(() => h.onScanCalls.length >= 3);
	h.scanner.stop();
	assertEquals(await p, null);
	assert(h.onScanCalls.every((r) => r.value === "AAA"));
	h.scanner.destroy();
});

Deno.test("continuous: multiple codes in one frame each fire onScan", async () => {
	const h = harness({
		mode: "continuous",
		detections: [makeDetection("AAA"), makeDetection("BBB")],
		dedupeMs: 60_000,
	});
	const p = h.scanner.start();
	await waitFor(() => h.onScanCalls.length >= 2);
	assertEquals(h.onScanCalls.map((r) => r.value), ["AAA", "BBB"]);
	h.scanner.stop();
	assertEquals(await p, null);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// Acquire error classification
// ---------------------------------------------------------------------------

const ACQUIRE_ERROR_CASES: [string, ScannerErrorCode][] = [
	["NotFoundError", ScannerErrorCode.NoDevice],
	["DevicesNotFoundError", ScannerErrorCode.NoDevice],
	["SecurityError", ScannerErrorCode.InsecureContext],
	["NotReadableError", ScannerErrorCode.DeviceBusy],
	["TrackStartError", ScannerErrorCode.DeviceBusy],
	["NotSupportedError", ScannerErrorCode.NotSupported],
	["SomeWeirdError", ScannerErrorCode.RequestFailed],
];

for (const [name, code] of ACQUIRE_ERROR_CASES) {
	Deno.test(`getStream ${name} → error ${code}, status "idle", start() null`, async () => {
		const h = harness({
			adapterOptions: {
				getStream: () => Promise.reject({ name, message: `mock ${name}` }),
			},
		});
		const result = await h.scanner.start();
		assertEquals(result, null);
		const s = h.scanner.get();
		assertEquals(s.status, "idle");
		assertEquals(s.error, { code, message: `mock ${name}` });
		assertEquals(s.permission, "unknown"); // not a permission problem
		assertEquals(h.onScanCalls.length, 0);
		assertEquals(h.onErrorCalls.length, 1);
		assertEquals(h.onErrorCalls[0].code, code);
		assertEquals(h.logger.warns.length, 1);
		h.scanner.destroy();
	});
}

for (const name of ["NotAllowedError", "PermissionDeniedError"]) {
	Deno.test(`getStream ${name} → permission "denied" + PERMISSION_DENIED`, async () => {
		const h = harness({
			adapterOptions: {
				getStream: () => Promise.reject({ name, message: "user said no" }),
			},
		});
		const result = await h.scanner.start();
		assertEquals(result, null);
		const s = h.scanner.get();
		assertEquals(s.permission, "denied");
		assertEquals(s.error?.code, ScannerErrorCode.PermissionDenied);
		assertEquals(s.status, "idle");
		assertEquals(h.onErrorCalls.length, 1);
		h.scanner.destroy();
	});
}

Deno.test("classifyAcquireError: DOMExceptions and non-error values", () => {
	assertEquals(
		classifyAcquireError(new DOMException("x", "NotFoundError")).code,
		ScannerErrorCode.NoDevice,
	);
	assertEquals(
		classifyAcquireError(new DOMException("x", "SecurityError")).code,
		ScannerErrorCode.InsecureContext,
	);
	assertEquals(
		classifyAcquireError(new DOMException("x", "NotReadableError")).code,
		ScannerErrorCode.DeviceBusy,
	);
	assertEquals(
		classifyAcquireError(new DOMException("x", "NotSupportedError")).code,
		ScannerErrorCode.NotSupported,
	);
	assertEquals(
		classifyAcquireError(new DOMException("x", "AbortError")).code,
		ScannerErrorCode.RequestFailed,
	);
	// non-Error rejection values must classify too
	const fromString = classifyAcquireError("plain failure");
	assertEquals(fromString.code, ScannerErrorCode.RequestFailed);
	assertEquals(fromString.message, "plain failure");
});

Deno.test("start() without video and without DOM → NOT_SUPPORTED", async () => {
	const adapter = createMockAdapter();
	const scanner = createScanner({
		adapter,
		detector: createMockDetector(),
		logger: createRecordingLogger(),
	});
	const result = await scanner.start();
	assertEquals(result, null);
	assertEquals(scanner.get().error?.code, ScannerErrorCode.NotSupported);
	assertEquals(scanner.get().status, "idle");
	assertEquals(adapter.getStreamCalls.length, 0); // failed before acquire
	scanner.destroy();
});

// ---------------------------------------------------------------------------
// Detector failures
// ---------------------------------------------------------------------------

Deno.test("detector: 5 consecutive failures → DETECTOR_FAILED, start() null", async () => {
	const h = harness();
	h.detector.setDetectFn(() => Promise.reject(new Error("decode blew up")));
	const result = await h.scanner.start();
	assertEquals(result, null);
	const s = h.scanner.get();
	assertEquals(s.status, "stopped");
	assertEquals(s.error, {
		code: ScannerErrorCode.DetectorFailed,
		message: "decode blew up",
	});
	assertEquals(h.detector.detectCalls, 5); // gave up exactly at the threshold
	assertEquals(h.track.stopCalls, 1);
	assertEquals(h.onErrorCalls.length, 1);
	assertEquals(h.onScanCalls.length, 0);
	h.scanner.destroy();
});

Deno.test("detector: failure counter resets on success (4 fails, then a hit)", async () => {
	const h = harness();
	h.detector.setDetectFn((i) =>
		i < 4
			? Promise.reject(new Error("flaky"))
			: Promise.resolve([makeDetection("recovered")])
	);
	const result = await h.scanner.start();
	assertEquals(result?.value, "recovered");
	assertEquals(h.scanner.get().error, null);
	assertEquals(h.scanner.get().status, "stopped");
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

Deno.test("destroy(): idempotent; start() after destroy resolves null and warns", async () => {
	const h = harness({ detections: [makeDetection("x")] });
	h.scanner.destroy();
	h.scanner.destroy(); // no throw
	assertEquals(h.logger.warns.length, 0);
	const result = await h.scanner.start();
	assertEquals(result, null);
	assertEquals(h.logger.warns.length, 1);
	assertStringIncludes(String(h.logger.warns[0][0]), "destroyed");
	// nothing was touched
	assertEquals(h.adapter.getStreamCalls.length, 0);
	assertEquals(h.detector.detectCalls, 0);
	assertEquals(h.onScanCalls.length, 0);
});

Deno.test("destroy() while scanning stops tracks and resolves start() null", async () => {
	const h = harness();
	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	h.scanner.destroy();
	assertEquals(await p, null);
	assertEquals(h.scanner.get().status, "stopped");
	assertEquals(h.track.stopCalls, 1);
	// post-destroy calls are safe no-ops
	h.scanner.stop();
	assertEquals(await h.scanner.setTorch(true), false);
	await h.scanner.setCamera("whatever");
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// setTorch()
// ---------------------------------------------------------------------------

Deno.test("setTorch: supported track → applyConstraints + state, resolves true", async () => {
	const h = harness({ trackOptions: { capabilities: { torch: true } } });
	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.scanner.get().torch, { supported: true, on: false });

	assertEquals(await h.scanner.setTorch(true), true);
	assertEquals(h.scanner.get().torch, { supported: true, on: true });
	assertEquals(h.track.appliedConstraints, [{ advanced: [{ torch: true }] }]);

	assertEquals(await h.scanner.setTorch(false), true);
	assertEquals(h.scanner.get().torch.on, false);

	// stop() resets torch.on
	assertEquals(await h.scanner.setTorch(true), true);
	h.scanner.stop();
	assertEquals(await p, null);
	assertEquals(h.scanner.get().torch.on, false);
	h.scanner.destroy();
});

Deno.test("setTorch: track without torch capability resolves false", async () => {
	const h = harness(); // getCapabilities() → {}
	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.scanner.get().torch.supported, false);
	assertEquals(await h.scanner.setTorch(true), false);
	assertEquals(h.scanner.get().torch.on, false);
	assertEquals(h.track.appliedConstraints.length, 0);
	h.scanner.stop();
	assertEquals(await p, null);
	h.scanner.destroy();
});

Deno.test("setTorch: without an active stream resolves false", async () => {
	const h = harness();
	assertEquals(await h.scanner.setTorch(true), false);
	h.scanner.destroy();
});

Deno.test("setTorch: applyConstraints failure resolves false, state untouched", async () => {
	const h = harness({
		trackOptions: {
			capabilities: { torch: true },
			applyConstraintsError: new Error("hw says no"),
		},
	});
	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(await h.scanner.setTorch(true), false);
	assertEquals(h.scanner.get().torch.on, false);
	assertEquals(h.logger.warns.length, 1);
	assertStringIncludes(String(h.logger.warns[0][0]), "setTorch");
	h.scanner.stop();
	assertEquals(await p, null);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// setCamera()
// ---------------------------------------------------------------------------

Deno.test("setCamera while scanning: old track stopped, new stream adopted", async () => {
	const track1 = createFakeTrack({ deviceId: "cam-1" });
	const track2 = createFakeTrack({ deviceId: "cam-2", capabilities: { torch: true } });
	const s1 = createFakeStream(track1).stream;
	const s2 = createFakeStream(track2).stream;
	const h = harness({
		adapterOptions: {
			getStream: (_c, i) => Promise.resolve(i === 0 ? s1 : s2),
		},
	});
	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.scanner.get().activeCameraId, "cam-1");

	await h.scanner.setCamera("cam-2");

	assertEquals(track1.stopCalls, 1); // released before acquiring the next one
	assertEquals(track2.stopCalls, 0);
	const s = h.scanner.get();
	assertEquals(s.activeCameraId, "cam-2");
	assertEquals(s.torch.supported, true); // re-derived from the new track
	assertEquals(s.status, "scanning"); // still running
	assertEquals(
		(h.adapter.getStreamCalls[1] as any).video.deviceId.exact,
		"cam-2",
	);

	h.scanner.stop();
	assertEquals(await p, null);
	assertEquals(track2.stopCalls, 1);
	h.scanner.destroy();
});

Deno.test("setCamera before start(): applied as exact deviceId on next acquire", async () => {
	const h = harness({ detections: [makeDetection("x")] });
	await h.scanner.setCamera("cam-9");
	assertEquals(h.adapter.getStreamCalls.length, 0); // nothing acquired yet
	const result = await h.scanner.start();
	assertEquals(result?.value, "x");
	assertEquals(
		(h.adapter.getStreamCalls[0] as any).video.deviceId.exact,
		"cam-9",
	);
	h.scanner.destroy();
});

Deno.test("setCamera failure while scanning: classified error + stop", async () => {
	const track1 = createFakeTrack({ deviceId: "cam-1" });
	const s1 = createFakeStream(track1).stream;
	const h = harness({
		adapterOptions: {
			getStream: (_c, i) =>
				i === 0
					? Promise.resolve(s1)
					: Promise.reject({ name: "NotReadableError", message: "busy" }),
		},
	});
	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	await h.scanner.setCamera("cam-2");
	assertEquals(h.scanner.get().error?.code, ScannerErrorCode.DeviceBusy);
	assertEquals(h.scanner.get().status, "stopped");
	assertEquals(await p, null);
	// released by setCamera AND again by the teardown — double stop is a
	// harmless no-op on real tracks
	assert(track1.stopCalls >= 1);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// Constraints building
// ---------------------------------------------------------------------------

Deno.test("constraints: default prefers environment facing, audio off", async () => {
	const h = harness({ detections: [makeDetection("x")] });
	await h.scanner.start();
	assertEquals(h.adapter.getStreamCalls[0], {
		video: { facingMode: { ideal: "environment" } },
		audio: false,
	});
	h.scanner.destroy();
});

Deno.test('constraints: preferredCamera "user" → facingMode user', async () => {
	const h = harness({
		detections: [makeDetection("x")],
		config: { preferredCamera: "user" },
	});
	await h.scanner.start();
	assertEquals(h.adapter.getStreamCalls[0], {
		video: { facingMode: { ideal: "user" } },
		audio: false,
	});
	h.scanner.destroy();
});

Deno.test("constraints: preferredCamera deviceId → exact deviceId", async () => {
	const h = harness({
		detections: [makeDetection("x")],
		config: { preferredCamera: "device-abc" },
	});
	await h.scanner.start();
	assertEquals(h.adapter.getStreamCalls[0], {
		video: { deviceId: { exact: "device-abc" } },
		audio: false,
	});
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// Cameras + permission tracking
// ---------------------------------------------------------------------------

Deno.test("listCameras(): returns and stores adapter devices", async () => {
	const cameras: CameraInfo[] = [
		{ deviceId: "a", label: "Back Camera", facing: "environment" },
		{ deviceId: "b", label: "Front Camera", facing: "user" },
	];
	const h = harness({ adapterOptions: { cameras } });
	const listed = await h.scanner.listCameras();
	assertEquals(listed, cameras);
	assertEquals(h.scanner.get().cameras, cameras);
	h.scanner.destroy();
});

Deno.test("adapter queryPermission result lands in state.permission", async () => {
	const h = harness({ adapterOptions: { queryResult: "granted" } });
	await waitMicrotasks(5);
	assertEquals(h.scanner.get().permission, "granted");
	h.scanner.destroy();
});

Deno.test("onPermissionChange updates state; destroy() unsubscribes", async () => {
	const h = harness({ adapterOptions: { supportsPermissionChange: true } });
	await waitMicrotasks(5);
	assert(h.adapter.permissionChangeCb, "adapter cb should be captured");
	h.adapter.permissionChangeCb!("denied");
	assertEquals(h.scanner.get().permission, "denied");
	h.scanner.destroy();
	assertEquals(h.adapter.unsubscribeCalls, 1);
	// a late event after destroy must not mutate state
	h.adapter.permissionChangeCb!("granted");
	assertEquals(h.scanner.get().permission, "denied");
});

// ---------------------------------------------------------------------------
// Visibility pause
// ---------------------------------------------------------------------------

Deno.test("loop pauses while document.visibilityState is hidden", async () => {
	const prev = _g.document;
	const fakeDoc = { visibilityState: "hidden" };
	_g.document = fakeDoc;
	try {
		const h = harness({ detections: [makeDetection("x")] });
		const p = h.scanner.start();
		await waitFor(() => h.scanner.get().status === "scanning");
		await sleep(60); // several frame ticks while hidden
		assertEquals(h.detector.detectCalls, 0);
		// tab becomes visible again → detection resumes and resolves
		fakeDoc.visibilityState = "visible";
		const result = await p;
		assertEquals(result?.value, "x");
		h.scanner.destroy();
	} finally {
		if (prev === undefined) delete _g.document;
		else _g.document = prev;
	}
});
