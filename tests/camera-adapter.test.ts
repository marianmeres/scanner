// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { createDefaultCameraAdapter, detectFacing } from "../src/camera-adapter.ts";
import { classifyAcquireError } from "../src/scanner.ts";
import type { CameraFacing } from "../src/types.ts";
import { ScannerErrorCode } from "../src/types.ts";
import { _g, waitMicrotasks } from "./_helpers.ts";

// ---------------------------------------------------------------------------
// navigator.* fakes (Deno's bare navigator has neither mediaDevices nor
// permissions — install them via defineProperty, micperms style)
// ---------------------------------------------------------------------------

function installNavigatorProp(prop: string, value: unknown): () => void {
	const nav = _g.navigator;
	const had = Object.prototype.hasOwnProperty.call(nav, prop);
	const prev = had ? nav[prop] : undefined;
	Object.defineProperty(nav, prop, {
		value,
		configurable: true,
		writable: true,
	});
	return () => {
		if (had) {
			Object.defineProperty(nav, prop, {
				value: prev,
				configurable: true,
				writable: true,
			});
		} else {
			delete nav[prop];
		}
	};
}

// ---------------------------------------------------------------------------
// detectFacing — label heuristics
// ---------------------------------------------------------------------------

const FACING_CASES: [string, CameraFacing | null][] = [
	["Back Camera", "environment"],
	["Rear Camera", "environment"],
	["camera2 0, facing back", "environment"],
	["environment", "environment"],
	["Front Camera", "user"],
	["camera2 1, facing front", "user"],
	["FaceTime HD Camera (Built-in)", "user"],
	["Selfie cam", "user"],
	["user cam", "user"],
	["Integrated Webcam", null],
	["USB Video Device", null],
	["Logitech BRIO", null],
	["", null],
];

for (const [label, expected] of FACING_CASES) {
	Deno.test(`detectFacing("${label}") → ${JSON.stringify(expected)}`, () => {
		assertEquals(detectFacing(label), expected);
	});
}

// ---------------------------------------------------------------------------
// getStream
// ---------------------------------------------------------------------------

Deno.test("getStream: rejects NotSupportedError without mediaDevices", async () => {
	const adapter = createDefaultCameraAdapter();
	const err = await assertRejects(() => adapter.getStream({ video: true }));
	assertEquals((err as Error).name, "NotSupportedError");
	// and the scanner taxonomy classifies it accordingly
	assertEquals(classifyAcquireError(err).code, ScannerErrorCode.NotSupported);
});

Deno.test("getStream: rejects NotSupportedError when getUserMedia is missing", async () => {
	const restore = installNavigatorProp("mediaDevices", {});
	try {
		const err = await assertRejects(() =>
			createDefaultCameraAdapter().getStream({ video: true })
		);
		assertEquals((err as Error).name, "NotSupportedError");
	} finally {
		restore();
	}
});

Deno.test("getStream: forwards constraints to getUserMedia, returns its stream", async () => {
	const calls: MediaStreamConstraints[] = [];
	const fakeStream = { getTracks: () => [] };
	const restore = installNavigatorProp("mediaDevices", {
		getUserMedia: (c: MediaStreamConstraints) => {
			calls.push(c);
			return Promise.resolve(fakeStream);
		},
	});
	try {
		const constraints = {
			video: { facingMode: { ideal: "environment" } },
			audio: false,
		} as MediaStreamConstraints;
		const stream = await createDefaultCameraAdapter().getStream(constraints);
		assertStrictEquals(stream, fakeStream as unknown as MediaStream);
		assertEquals(calls.length, 1);
		assertStrictEquals(calls[0], constraints);
	} finally {
		restore();
	}
});

Deno.test("getStream: getUserMedia rejection passes through unmodified", async () => {
	const boom = new DOMException("nope", "NotAllowedError");
	const restore = installNavigatorProp("mediaDevices", {
		getUserMedia: () => Promise.reject(boom),
	});
	try {
		const err = await assertRejects(() =>
			createDefaultCameraAdapter().getStream({ video: true })
		);
		assertStrictEquals(err, boom);
	} finally {
		restore();
	}
});

// ---------------------------------------------------------------------------
// enumerateVideoDevices
// ---------------------------------------------------------------------------

Deno.test("enumerateVideoDevices: [] without mediaDevices", async () => {
	assertEquals(await createDefaultCameraAdapter().enumerateVideoDevices(), []);
});

Deno.test("enumerateVideoDevices: filters videoinput, maps labels + facing", async () => {
	const restore = installNavigatorProp("mediaDevices", {
		enumerateDevices: () =>
			Promise.resolve([
				{ kind: "videoinput", deviceId: "v1", label: "Back Camera" },
				{ kind: "audioinput", deviceId: "a1", label: "Microphone" },
				{ kind: "videoinput", deviceId: "v2", label: "FaceTime HD Camera" },
				// pre-permission: label may be missing/empty
				{ kind: "videoinput", deviceId: "v3", label: undefined },
				{ kind: "audiooutput", deviceId: "o1", label: "Speakers" },
			]),
	});
	try {
		assertEquals(await createDefaultCameraAdapter().enumerateVideoDevices(), [
			{ deviceId: "v1", label: "Back Camera", facing: "environment" },
			{ deviceId: "v2", label: "FaceTime HD Camera", facing: "user" },
			{ deviceId: "v3", label: "", facing: null },
		]);
	} finally {
		restore();
	}
});

// ---------------------------------------------------------------------------
// Permission plumbing — delegated to @marianmeres/mediaperms via an injected
// fake MediaPerms instance (the raw Permissions API wiring is mediaperms'
// job and is tested there)
// ---------------------------------------------------------------------------

function fakePerms(initialStatus = "unknown") {
	const subscribers = new Set<(s: any) => void>();
	let state = { status: initialStatus };
	return {
		checkCalls: 0,
		checkResult: initialStatus as string | Error,
		destroyCalls: 0,
		emit(status: string) {
			state = { ...state, status };
			subscribers.forEach((cb) => cb(state));
		},
		handle: {
			subscribe(cb: (s: any) => void) {
				subscribers.add(cb);
				cb(state); // mediaperms contract: fires immediately
				return () => subscribers.delete(cb);
			},
			get: () => state,
			check() {
				(this as any)._parent.checkCalls++;
				const r = (this as any)._parent.checkResult;
				return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
			},
			destroy() {
				(this as any)._parent.destroyCalls++;
			},
		} as any,
	};
}

function adapterWithFakePerms(initialStatus = "unknown") {
	const fake = fakePerms(initialStatus);
	fake.handle._parent = fake;
	const adapter = createDefaultCameraAdapter({ perms: fake.handle });
	return { fake, adapter };
}

Deno.test("queryPermission: delegates to perms.check(), passes status through", async () => {
	const { fake, adapter } = adapterWithFakePerms();
	for (const status of ["granted", "denied", "prompt"]) {
		fake.checkResult = status;
		assertEquals(await adapter.queryPermission(), status);
	}
	assertEquals(fake.checkCalls, 3);
});

Deno.test('queryPermission: "unknown" maps to null (no information)', async () => {
	const { fake, adapter } = adapterWithFakePerms();
	fake.checkResult = "unknown";
	assertEquals(await adapter.queryPermission(), null);
});

Deno.test("queryPermission: null when check() rejects", async () => {
	const { fake, adapter } = adapterWithFakePerms();
	fake.checkResult = new Error("boom");
	assertEquals(await adapter.queryPermission(), null);
});

Deno.test("onPermissionChange: skips immediate emission, forwards changes, dedupes", () => {
	const { fake, adapter } = adapterWithFakePerms("prompt");
	const seen: string[] = [];
	const unsub = adapter.onPermissionChange((s) => seen.push(s));
	assert(typeof unsub === "function", "expected an unsubscribe fn");
	assertEquals(seen, []); // immediate subscribe emission skipped

	fake.emit("granted");
	assertEquals(seen, ["granted"]);
	fake.emit("granted"); // no change — deduped
	assertEquals(seen, ["granted"]);
	fake.emit("denied");
	assertEquals(seen, ["granted", "denied"]);

	unsub!();
	fake.emit("prompt");
	assertEquals(seen, ["granted", "denied"]); // detached
});

Deno.test("destroy: does NOT destroy a shared (injected) perms instance", () => {
	const { fake, adapter } = adapterWithFakePerms();
	adapter.destroy?.();
	assertEquals(fake.destroyCalls, 0);
	// and the adapter degrades gracefully afterwards
	assertEquals(adapter.onPermissionChange(() => {}), null);
});

Deno.test("queryPermission: null after destroy", async () => {
	const { fake, adapter } = adapterWithFakePerms();
	fake.checkResult = "granted";
	adapter.destroy?.();
	assertEquals(await adapter.queryPermission(), null);
	assertEquals(fake.checkCalls, 0);
});

Deno.test("integration: internally created camPerms works headless and is destroyed", async () => {
	// no fakes — the adapter lazily creates a real createCamPerms(); in Deno
	// (no Permissions API) check() yields "unknown" → adapter maps to null
	const adapter = createDefaultCameraAdapter();
	assertEquals(await adapter.queryPermission(), null);
	const unsub = adapter.onPermissionChange(() => {});
	assert(typeof unsub === "function");
	unsub!();
	adapter.destroy?.(); // destroys the internal instance (listeners cleaned up)
	adapter.destroy?.(); // idempotent
	await waitMicrotasks(5);
});
