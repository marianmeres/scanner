// deno-lint-ignore-file no-explicit-any
/**
 * Lifecycle race regressions. The scanner invalidates in-flight async work
 * (stream acquisition, frame decodes, camera switches, torch toggles, timers)
 * via a `generation` counter bumped on every start/stop. Each test here
 * FAILS if one of those guards is removed:
 *
 * - stale detect() resolution after stop()+start()
 * - stale getStream rejection after stop()+start() / destroy()
 * - setCamera serialization + stale switch failure isolation
 * - setTorch settling after stop()
 * - track "ended" teardown + listener detach
 * - torch re-probe timer (fire + cancellation)
 *
 * All async seams use deferred promises so the TEST decides when they settle.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { createScanner } from "../src/scanner.ts";
import type {
	DetectedBarcodeLike,
	ScanMode,
	ScannerError,
	ScanResult,
} from "../src/types.ts";
import { ScannerErrorCode } from "../src/types.ts";
import {
	asVideoEl,
	createFakeStream,
	createFakeTrack,
	createMockAdapter,
	createMockDetector,
	createRecordingLogger,
	createStubVideo,
	type FakeTrack,
	type FakeTrackOptions,
	makeDetection,
	type MockAdapterOptions,
	sleep,
	waitFor,
	waitMicrotasks,
} from "./_helpers.ts";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
}

/** A promise settled manually by the test (controls WHEN async seams resolve). */
function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Fake track that also supports add/removeEventListener + manual dispatch. */
interface EventedTrack extends FakeTrack {
	removedCount: number;
	listenerCount(type: string): number;
	addEventListener(type: string, cb: () => void): void;
	removeEventListener(type: string, cb: () => void): void;
	dispatch(type: string): void;
}

function createEventedTrack(options: FakeTrackOptions = {}): EventedTrack {
	const listeners = new Map<string, Set<() => void>>();
	const track = createFakeTrack(options) as EventedTrack;
	track.removedCount = 0;
	track.addEventListener = (type, cb) => {
		if (!listeners.has(type)) listeners.set(type, new Set());
		listeners.get(type)!.add(cb);
	};
	track.removeEventListener = (type, cb) => {
		track.removedCount++;
		listeners.get(type)?.delete(cb);
	};
	track.listenerCount = (type) => listeners.get(type)?.size ?? 0;
	track.dispatch = (type) => {
		// iterate a copy — a listener may remove itself mid-dispatch
		for (const cb of [...(listeners.get(type) ?? [])]) cb();
	};
	return track;
}

interface RaceHarnessOptions {
	mode?: ScanMode;
	dedupeMs?: number;
	/** Per-call stream factory. Default: fresh fake stream every call. */
	getStream?: MockAdapterOptions["getStream"];
}

function harness(opts: RaceHarnessOptions = {}) {
	const logger = createRecordingLogger();
	const video = createStubVideo();
	const detector = createMockDetector([]);
	const adapter = createMockAdapter(
		opts.getStream ? { getStream: opts.getStream } : {},
	);
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
	});
	return { scanner, adapter, detector, video, logger, onScanCalls, onErrorCalls };
}

// ---------------------------------------------------------------------------
// 1. Stale detect()
// ---------------------------------------------------------------------------

Deno.test("race: stale detect() resolving after stop()+start() must not leak into session 2", async () => {
	const dStale = deferred<DetectedBarcodeLike[]>();
	const h = harness();
	// detect call 0 belongs to session 1 and stays pending until WE resolve
	// it; every later call (session 2) finds nothing
	h.detector.setDetectFn((i) => (i === 0 ? dStale.promise : Promise.resolve([])));

	const p1 = h.scanner.start();
	await waitFor(() => h.detector.detectCalls >= 1); // session 1 decode in flight

	h.scanner.stop();
	assertEquals(await p1, null);

	const p2 = h.scanner.start();
	let p2Settled = false;
	void p2.then(() => {
		p2Settled = true;
	});
	await waitFor(() => h.scanner.get().status === "scanning");
	await waitFor(() => h.detector.detectCalls >= 2); // session 2 loop is live

	// the STALE session-1 decode completes now — with a hit
	dStale.resolve([makeDetection("stale")]);
	await waitMicrotasks(10);

	assertEquals(p2Settled, false); // session 2 start() untouched
	assertEquals(h.onScanCalls.length, 0); // no onScan for the stale hit
	assertEquals(h.scanner.get().lastResult, null);
	assertEquals(h.scanner.get().status, "scanning"); // session 2 keeps going
	// ... and its loop is still alive
	const calls = h.detector.detectCalls;
	await waitFor(() => h.detector.detectCalls > calls);

	h.scanner.stop();
	assertEquals(await p2, null);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// 2. Stale getStream rejection (stop + restart)
// ---------------------------------------------------------------------------

Deno.test("race: stale getStream rejection after stop()+start() must not touch session 2", async () => {
	const d1 = deferred<MediaStream>();
	const d2 = deferred<MediaStream>();
	const h = harness({ getStream: (_c, i) => (i === 0 ? d1.promise : d2.promise) });

	const p1 = h.scanner.start();
	assertEquals(h.scanner.get().status, "initializing");
	h.scanner.stop();
	assertEquals(await p1, null);
	assertEquals(h.scanner.get().status, "stopped");

	const p2 = h.scanner.start();
	let p2Settled = false;
	void p2.then(() => {
		p2Settled = true;
	});
	assertEquals(h.scanner.get().status, "initializing");

	// the STALE session-1 acquire fails now — nobody is waiting for it
	d1.reject({ name: "NotReadableError", message: "mock busy" });
	await waitMicrotasks(10);

	assertEquals(h.onErrorCalls.length, 0);
	assertEquals(h.scanner.get().error, null);
	assertEquals(h.scanner.get().status, "initializing"); // session 2 unaffected
	assertEquals(p2Settled, false);
	// coalescing intact — the stale failure did not finish/clear startPromise
	const p3 = h.scanner.start();
	assertStrictEquals(p3, p2);

	// session 2 proceeds normally once ITS stream arrives
	d2.resolve(createFakeStream(createFakeTrack({ deviceId: "cam-2" })).stream);
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.scanner.get().activeCameraId, "cam-2");
	assertEquals(h.scanner.get().error, null);
	await waitMicrotasks(5);
	assertEquals(p2Settled, false); // detector finds nothing — still scanning

	h.scanner.stop();
	assertEquals(await p2, null);
	assertEquals(await p3, null);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// 3. Stale getStream rejection (destroy)
// ---------------------------------------------------------------------------

Deno.test("race: stale getStream rejection after destroy() is fully swallowed", async () => {
	const d1 = deferred<MediaStream>();
	const h = harness({ getStream: () => d1.promise });

	const p1 = h.scanner.start();
	h.scanner.destroy();
	assertEquals(await p1, null);
	assertEquals(h.scanner.get().status, "stopped");

	// nobody left to care — must not report, mutate state, nor throw
	d1.reject({ name: "NotReadableError", message: "mock busy" });
	await waitMicrotasks(10);

	assertEquals(h.onErrorCalls.length, 0);
	assertEquals(h.scanner.get().error, null);
	assertEquals(h.scanner.get().status, "stopped");
});

// ---------------------------------------------------------------------------
// 4. setCamera serialization
// ---------------------------------------------------------------------------

Deno.test("race: concurrent setCamera calls serialize — the second is not dropped", async () => {
	const trackA = createFakeTrack({ deviceId: "cam-a" });
	const trackB = createFakeTrack({ deviceId: "cam-b" });
	const trackC = createFakeTrack({ deviceId: "cam-c" });
	const streamA = createFakeStream(trackA).stream;
	const streamB = createFakeStream(trackB).stream;
	const streamC = createFakeStream(trackC).stream;
	const dB = deferred<MediaStream>();
	const dC = deferred<MediaStream>();
	const h = harness({
		getStream: (_c, i) => {
			if (i === 0) return Promise.resolve(streamA);
			if (i === 1) return dB.promise;
			return dC.promise;
		},
	});

	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.scanner.get().activeCameraId, "cam-a");

	const pB = h.scanner.setCamera("cam-b");
	const pC = h.scanner.setCamera("cam-c"); // issued mid-switch, not awaited
	await waitFor(() => h.adapter.getStreamCalls.length === 2);
	dB.resolve(streamB);
	// the second switch must run AFTER the first finished — a non-serialized
	// implementation would see `stream === null` and silently no-op
	await waitFor(() => h.adapter.getStreamCalls.length === 3);
	dC.resolve(streamC);
	await pB;
	await pC;

	assertEquals(h.scanner.get().activeCameraId, "cam-c");
	assertEquals(h.scanner.get().status, "scanning");
	assertEquals((h.adapter.getStreamCalls[1] as any).video.deviceId.exact, "cam-b");
	assertEquals((h.adapter.getStreamCalls[2] as any).video.deviceId.exact, "cam-c");
	assert(trackA.stopCalls >= 1, "cam-a released");
	assert(trackB.stopCalls >= 1, "intermediate cam-b stream released");
	assertEquals(trackC.stopCalls, 0); // live

	h.scanner.stop();
	assertEquals(await p, null);
	assert(trackC.stopCalls >= 1);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// 5. setCamera no-op on the active camera
// ---------------------------------------------------------------------------

Deno.test("setCamera to the already-active camera is a no-op (no re-acquire)", async () => {
	const track = createFakeTrack({ deviceId: "cam-a" });
	const stream = createFakeStream(track).stream;
	const h = harness({ getStream: () => Promise.resolve(stream) });

	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.adapter.getStreamCalls.length, 1);

	await h.scanner.setCamera("cam-a");

	assertEquals(h.adapter.getStreamCalls.length, 1); // NOT re-acquired
	assertEquals(h.scanner.get().activeCameraId, "cam-a");
	assertEquals(h.scanner.get().status, "scanning");
	assertEquals(track.stopCalls, 0); // live stream untouched

	h.scanner.stop();
	assertEquals(await p, null);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// 6. Stale setCamera failure vs a new session
// ---------------------------------------------------------------------------

Deno.test("race: stale setCamera failure must not kill the session that replaced it", async () => {
	const trackA = createFakeTrack({ deviceId: "cam-a" });
	const trackFresh = createFakeTrack({ deviceId: "cam-fresh" });
	const streamA = createFakeStream(trackA).stream;
	const streamFresh = createFakeStream(trackFresh).stream;
	const dB = deferred<MediaStream>();
	const h = harness({
		getStream: (_c, i) => {
			if (i === 0) return Promise.resolve(streamA);
			if (i === 1) return dB.promise; // the live switch — stays pending
			return Promise.resolve(streamFresh); // session 2
		},
	});

	const p1 = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");

	const pSwitch = h.scanner.setCamera("cam-b"); // not awaited
	await waitFor(() => h.adapter.getStreamCalls.length === 2);

	h.scanner.stop();
	assertEquals(await p1, null);

	const p2 = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.scanner.get().activeCameraId, "cam-fresh");

	// the STALE switch fails now
	dB.reject({ name: "NotReadableError", message: "mock busy" });
	await pSwitch; // resolves (never rejects) — and must not kill session 2
	await waitMicrotasks(10);

	assertEquals(h.scanner.get().status, "scanning");
	assertEquals(h.scanner.get().error, null);
	assertEquals(h.onErrorCalls.length, 0);

	h.scanner.stop();
	assertEquals(await p2, null);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// 7. setTorch settling after stop()
// ---------------------------------------------------------------------------

Deno.test("race: setTorch resolving after stop() reports false and does not flip state", async () => {
	const track = createFakeTrack({ deviceId: "cam-a", capabilities: { torch: true } });
	const dApply = deferred<void>();
	track.applyConstraints = () => dApply.promise;
	const stream = createFakeStream(track).stream;
	const h = harness({ getStream: () => Promise.resolve(stream) });

	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.scanner.get().torch, { supported: true, on: false });

	const pTorch = h.scanner.setTorch(true); // hangs on applyConstraints
	h.scanner.stop();
	assertEquals(await p, null);
	dApply.resolve(); // hardware "succeeds" — but the session is gone

	assertEquals(await pTorch, false);
	assertEquals(h.scanner.get().torch.on, false);
	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// 8. Track "ended"
// ---------------------------------------------------------------------------

Deno.test("track 'ended' mid-scan stops with REQUEST_FAILED and detaches the listener", async () => {
	const track = createEventedTrack({ deviceId: "cam-a" });
	const stream = createFakeStream(track).stream;
	const h = harness({ getStream: () => Promise.resolve(stream) });

	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(track.listenerCount("ended"), 1);
	await waitFor(() => h.detector.detectCalls >= 1); // loop demonstrably runs

	track.dispatch("ended"); // OS kills the camera

	assertEquals(await p, null);
	const s = h.scanner.get();
	assertEquals(s.status, "stopped");
	assertEquals(s.error?.code, ScannerErrorCode.RequestFailed);
	assertEquals(h.onErrorCalls.length, 1);
	assert(track.stopCalls >= 1);

	// listener detached by the teardown
	assert(track.removedCount >= 1, "removeEventListener called");
	assertEquals(track.listenerCount("ended"), 0);

	// the loop is dead — no further decode attempts
	const callsAtStop = h.detector.detectCalls;
	await sleep(40);
	assertEquals(h.detector.detectCalls, callsAtStop);

	// a second "ended" is inert (already detached; nothing fires twice)
	track.dispatch("ended");
	assertEquals(h.onErrorCalls.length, 1);
	assertEquals(h.scanner.get().status, "stopped");

	h.scanner.destroy();
});

// ---------------------------------------------------------------------------
// 9. Torch re-probe timer
// ---------------------------------------------------------------------------

Deno.test("torch re-probe: late-appearing torch capability flips torch.supported", async () => {
	let torchAvailable = false;
	const track = createFakeTrack({ deviceId: "cam-a" });
	track.getCapabilities = () => (torchAvailable ? { torch: true } : {});
	const stream = createFakeStream(track).stream;
	const h = harness({ getStream: () => Promise.resolve(stream) });

	const p = h.scanner.start();
	await waitFor(() => h.scanner.get().status === "scanning");
	assertEquals(h.scanner.get().torch.supported, false);

	torchAvailable = true; // Android-Chrome-style late capability
	// the re-probe fires ~500ms after stream adoption (real timers)
	await waitFor(() => h.scanner.get().torch.supported === true, 900);
	assertEquals(h.scanner.get().torch.on, false);

	h.scanner.stop();
	assertEquals(await p, null);
	h.scanner.destroy();
});

Deno.test("torch re-probe: stop() before the probe fires clears the pending timer", async () => {
	// NOTE: a leaked setTimeout does NOT trip Deno's test sanitizer anymore
	// (verified on Deno 2.9 — timers are no longer tracked async ops), and
	// the gen guard inside the probe callback makes a stale firing invisible
	// through the public API. So the cancellation contract is asserted
	// directly: spy on global setTimeout/clearTimeout and require that the
	// 500ms probe timer scheduled on stream adoption is cleared by stop().
	const origSetTimeout = globalThis.setTimeout;
	const origClearTimeout = globalThis.clearTimeout;
	const probeIds = new Set<unknown>();
	const clearedIds = new Set<unknown>();
	globalThis.setTimeout = ((fn: any, ms?: number, ...args: any[]) => {
		const id = origSetTimeout(fn, ms, ...args);
		if (ms === 500) probeIds.add(id); // the re-probe delay
		return id;
	}) as typeof setTimeout;
	globalThis.clearTimeout = ((id?: number) => {
		if (id != null) clearedIds.add(id);
		return origClearTimeout(id);
	}) as typeof clearTimeout;

	try {
		let torchAvailable = false;
		const track = createFakeTrack({ deviceId: "cam-a" });
		track.getCapabilities = () => (torchAvailable ? { torch: true } : {});
		const stream = createFakeStream(track).stream;
		const h = harness({ getStream: () => Promise.resolve(stream) });

		const p = h.scanner.start();
		await waitFor(() => h.scanner.get().status === "scanning");
		assertEquals(probeIds.size, 1); // the re-probe was scheduled
		torchAvailable = true; // WOULD flip supported if the probe ever ran

		h.scanner.stop(); // well before the 500ms probe delay
		assertEquals(await p, null);
		for (const id of probeIds) {
			assert(clearedIds.has(id), "stop() must clear the pending re-probe timer");
		}
		await waitMicrotasks(5);
		assertEquals(h.scanner.get().torch.supported, false);
		h.scanner.destroy();
	} finally {
		globalThis.setTimeout = origSetTimeout;
		globalThis.clearTimeout = origClearTimeout;
	}
});

// ---------------------------------------------------------------------------
// 10. Continuous dedupe window expiry (+ prune branch execution)
// ---------------------------------------------------------------------------

Deno.test("continuous dedupe: expired code re-fires (also drives the >64 `seen` prune)", async () => {
	// NOTE: the `seen` map pruning (size > 64) is pure memory hygiene — it is
	// behaviorally indistinguishable from plain dedupe-window expiry, because
	// the per-key timestamp check alone already re-emits expired codes. This
	// test is therefore a window-expiry regression that also EXECUTES the
	// prune branch (70 entries, all expired at prune time) so a future
	// crash/mutation-during-iteration bug in the prune loop surfaces here.
	const h = harness({ mode: "continuous", dedupeMs: 10 });
	h.detector.setDetectFn((i) =>
		i === 0
			? Promise.resolve(
				Array.from({ length: 70 }, (_, k) => makeDetection(`code-${k}`)),
			)
			: Promise.resolve([makeDetection("code-0")])
	);

	const p = h.scanner.start();
	// frame 0 emits 70 unique codes → `seen` grows past the 64 prune threshold
	await waitFor(() => h.onScanCalls.length >= 70);
	assertEquals(
		h.onScanCalls.slice(0, 70).map((r) => r.value),
		Array.from({ length: 70 }, (_, k) => `code-${k}`),
	);
	// subsequent frames re-detect code-0; frames are >=16ms apart (setTimeout
	// fallback) which is beyond dedupeMs=10 — the expired window must re-fire
	// it every time, pruned or not
	await waitFor(() => h.onScanCalls.filter((r) => r.value === "code-0").length >= 3);

	h.scanner.stop();
	assertEquals(await p, null);
	assertEquals(h.scanner.get().status, "stopped");
	h.scanner.destroy();
});
