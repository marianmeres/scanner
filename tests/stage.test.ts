import { assert, assertEquals, assertThrows } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { createScannerStage, type ScannerStageOptions } from "../src/stage.ts";
import type { CameraInfo, Scanner, ScannerState, ScanResult } from "../src/types.ts";

// ---------------------------------------------------------------------------
// DOM-backed tests for the `createScannerStage` renderer. The scanner itself
// is a hand-rolled mock (spy-able methods + manually fired subscribe
// emissions) — these tests cover only the DOM wiring: mounting, style
// injection, state → attribute/visibility reflection, control button
// behavior, the success flash and teardown. deno-dom supplies a real-enough
// document; setup mirrors micperms' mic-reenable-guide-dom.test.ts.
// ---------------------------------------------------------------------------

// deno-dom (0.1.x) ships a partial DOM — `Element.style` (CSSStyleDeclaration)
// is not implemented, while the stage unconditionally reads/writes
// `container.style.position` and (with the `accent` option) calls
// `el.style.setProperty`. Polyfill a minimal per-element style object onto the
// shared node prototype for the test process. Idempotent and test-only.
// deno-lint-ignore no-explicit-any
function patchDom(doc: any): void {
	const probe = doc.createElement("div");
	let proto = Object.getPrototypeOf(probe);
	while (
		proto && !Object.prototype.hasOwnProperty.call(proto, "appendChild")
	) {
		proto = Object.getPrototypeOf(proto);
	}
	const target = proto ?? Object.getPrototypeOf(probe);

	if (typeof probe.style === "undefined") {
		// deno-lint-ignore no-explicit-any
		const styles = new WeakMap<object, any>();
		Object.defineProperty(target, "style", {
			configurable: true,
			get() {
				let s = styles.get(this);
				if (!s) {
					s = {};
					Object.defineProperty(s, "setProperty", {
						value: (name: string, value: string) => {
							s[name] = value;
						},
					});
					Object.defineProperty(s, "getPropertyValue", {
						value: (name: string) => s[name] ?? "",
					});
					styles.set(this, s);
				}
				return s;
			},
		});
	}
}

function withDocument(fn: (doc: Document) => void): void {
	const doc = new DOMParser().parseFromString(
		"<!DOCTYPE html><html><head></head><body></body></html>",
		"text/html",
	) as unknown as Document;
	patchDom(doc);
	// deno-lint-ignore no-explicit-any
	(globalThis as any).document = doc;
	try {
		fn(doc);
	} finally {
		// deno-lint-ignore no-explicit-any
		delete (globalThis as any).document;
	}
}

// deno-dom elements do not implement `.click()` — dispatch a synthetic event
// (deno-dom nodes extend the native EventTarget, so listeners fire).
// deno-lint-ignore no-explicit-any
function fireClick(el: any): void {
	el.dispatchEvent(new Event("click"));
}

const cam = (deviceId: string, facing: CameraInfo["facing"] = null): CameraInfo => ({
	deviceId,
	label: `label of ${deviceId}`,
	facing,
});

const scanResult = (value: string, timestamp: number): ScanResult => ({
	value,
	format: "qr_code",
	cornerPoints: [],
	boundingBox: { x: 0, y: 0, width: 10, height: 10 } as unknown as DOMRectReadOnly,
	timestamp,
});

/**
 * Hand-rolled mock Scanner: keeps subscribers, `emit(patch)` fires them with
 * a merged state, `stop`/`setTorch`/`setCamera` are recorded as spies,
 * the rest are inert stubs. Must be created inside `withDocument` (the video
 * element needs a document).
 */
function createMockScanner(initial: Partial<ScannerState> = {}) {
	let state: ScannerState = {
		status: "idle",
		error: null,
		permission: "unknown",
		torch: { supported: false, on: false },
		cameras: [],
		activeCameraId: null,
		lastResult: null,
		...initial,
	};
	const subscribers = new Set<(s: ScannerState) => void>();
	const calls = {
		stop: 0,
		destroy: 0,
		setTorch: [] as boolean[],
		setCamera: [] as string[],
	};
	let video: HTMLVideoElement | null = document.createElement(
		"video",
	) as unknown as HTMLVideoElement;

	const scanner: Scanner = {
		subscribe(cb) {
			subscribers.add(cb);
			cb(state); // svelte store contract — fire immediately
			const unsub = () => {
				subscribers.delete(cb);
			};
			// Scanner.subscribe returns a store Unsubscribe (Symbol.dispose-able)
			(unsub as any)[Symbol.dispose] = unsub;
			return unsub as unknown as ReturnType<Scanner["subscribe"]>;
		},
		get: () => state,
		start: () => Promise.resolve(null),
		stop() {
			calls.stop++;
		},
		listCameras: () => Promise.resolve(state.cameras),
		setCamera(deviceId: string) {
			calls.setCamera.push(deviceId);
			return Promise.resolve();
		},
		setTorch(on: boolean) {
			calls.setTorch.push(on);
			return Promise.resolve(true);
		},
		getVideo: () => video,
		destroy() {
			calls.destroy++;
		},
	};

	return {
		scanner,
		calls,
		emit(patch: Partial<ScannerState>): void {
			state = { ...state, ...patch };
			for (const cb of [...subscribers]) cb(state);
		},
		subscriberCount: () => subscribers.size,
		setVideo(v: HTMLVideoElement | null): void {
			video = v;
		},
	};
}

function mount(
	doc: Document,
	options: Partial<ScannerStageOptions> = {},
	initial: Partial<ScannerState> = {},
) {
	const mock = createMockScanner(initial);
	const container = doc.createElement("div") as unknown as HTMLElement;
	const stage = createScannerStage(mock.scanner, { container, ...options });
	return { mock, container, stage };
}

Deno.test("stage: mounts root + video into container, injects styles once", () => {
	withDocument((doc) => {
		const { container, stage } = mount(doc);

		// root present and mounted
		assertEquals(stage.el.className, "mms-stage");
		assert(container.querySelector(".mms-stage"), "root should be in container");

		// the scanner's video element is inside the root
		const video = stage.el.querySelector("video");
		assert(video, "video element should be inside the stage");
		assert(video!.classList.contains("mms-video"));

		// viewfinder chrome
		assertEquals(stage.el.querySelectorAll(".mms-corner").length, 4);
		assert(stage.el.querySelector(".mms-scanline"), "scan line renders by default");

		// second stage — style tag must not duplicate
		const { stage: stage2 } = mount(doc);
		const styles = doc.querySelectorAll("style#mms-styles");
		assertEquals(styles.length, 1, "styles must be injected exactly once");
		assertEquals(styles[0].parentNode, doc.head);

		stage.destroy();
		stage2.destroy();
	});
});

Deno.test("stage: data-status reflects state emissions", () => {
	withDocument((doc) => {
		const { mock, stage } = mount(doc);

		// subscribe fires immediately with the initial state
		assertEquals(stage.el.getAttribute("data-status"), "idle");

		mock.emit({ status: "scanning" });
		assertEquals(stage.el.getAttribute("data-status"), "scanning");

		stage.destroy();
	});
});

Deno.test("stage: default controls render only cancel", () => {
	withDocument((doc) => {
		const { stage } = mount(doc);

		assert(stage.el.querySelector(".mms-btn-cancel"), "cancel renders by default");
		assertEquals(stage.el.querySelector(".mms-btn-torch"), null);
		assertEquals(stage.el.querySelector(".mms-btn-switch"), null);

		stage.destroy();
	});
});

Deno.test("stage: torch/switch buttons hide until supported, aria-pressed follows torch.on", () => {
	withDocument((doc) => {
		const { mock, stage } = mount(doc, {
			controls: { torch: true, cameraSwitch: true },
		});

		const torchBtn = stage.el.querySelector(".mms-btn-torch")!;
		const switchBtn = stage.el.querySelector(".mms-btn-switch")!;
		assert(torchBtn, "torch button should render when opted in");
		assert(switchBtn, "switch button should render when opted in");

		// hidden initially (unsupported torch, no cameras)
		assert(torchBtn.hasAttribute("hidden"));
		assert(switchBtn.hasAttribute("hidden"));

		// torch becomes supported → unhidden, aria-pressed mirrors torch.on
		mock.emit({ torch: { supported: true, on: false } });
		assert(!torchBtn.hasAttribute("hidden"));
		assertEquals(torchBtn.getAttribute("aria-pressed"), "false");

		mock.emit({ torch: { supported: true, on: true } });
		assertEquals(torchBtn.getAttribute("aria-pressed"), "true");

		// 2+ cameras → switch unhidden; back to 1 → hidden again
		mock.emit({ cameras: [cam("cam-a"), cam("cam-b")] });
		assert(!switchBtn.hasAttribute("hidden"));

		mock.emit({ cameras: [cam("cam-a")] });
		assert(switchBtn.hasAttribute("hidden"));

		stage.destroy();
	});
});

Deno.test("stage: cancel click stops the scanner and calls onCancel", () => {
	withDocument((doc) => {
		let cancelled = 0;
		const { mock, stage } = mount(doc, { onCancel: () => cancelled++ });

		fireClick(stage.el.querySelector(".mms-btn-cancel")!);

		assertEquals(mock.calls.stop, 1);
		assertEquals(cancelled, 1);

		stage.destroy();
	});
});

Deno.test("stage: torch click toggles — setTorch(!state.torch.on)", () => {
	withDocument((doc) => {
		const { mock, stage } = mount(doc, { controls: { torch: true } });
		const torchBtn = stage.el.querySelector(".mms-btn-torch")!;

		mock.emit({ torch: { supported: true, on: false } });
		fireClick(torchBtn);
		assertEquals(mock.calls.setTorch, [true]);

		mock.emit({ torch: { supported: true, on: true } });
		fireClick(torchBtn);
		assertEquals(mock.calls.setTorch, [true, false]);

		stage.destroy();
	});
});

Deno.test("stage: switch click cycles to the other camera", () => {
	withDocument((doc) => {
		const { mock, stage } = mount(doc, { controls: { cameraSwitch: true } });
		const switchBtn = stage.el.querySelector(".mms-btn-switch")!;

		// fewer than 2 cameras → click is a no-op
		mock.emit({ cameras: [cam("cam-a")], activeCameraId: "cam-a" });
		fireClick(switchBtn);
		assertEquals(mock.calls.setCamera, []);

		const cameras = [cam("cam-a", "environment"), cam("cam-b", "user")];
		mock.emit({ cameras, activeCameraId: "cam-a" });
		fireClick(switchBtn);
		assertEquals(mock.calls.setCamera, ["cam-b"]);

		// cycling wraps around
		mock.emit({ activeCameraId: "cam-b" });
		fireClick(switchBtn);
		assertEquals(mock.calls.setCamera, ["cam-b", "cam-a"]);

		stage.destroy();
	});
});

Deno.test("stage: new lastResult triggers the success flash class", () => {
	withDocument((doc) => {
		const { mock, stage } = mount(doc);

		assert(!stage.el.classList.contains("mms-flash"));

		mock.emit({ lastResult: scanResult("hello", Date.now()) });
		assert(stage.el.classList.contains("mms-flash"));

		// same result re-emitted (same timestamp) must not re-arm anything
		mock.emit({ status: "stopped" });
		assert(stage.el.classList.contains("mms-flash"));

		// destroy clears the pending flash timer (keeps the sanitizers happy)
		stage.destroy();
	});
});

Deno.test("stage: destroy unmounts, unsubscribes and leaves the scanner alone", () => {
	withDocument((doc) => {
		const { mock, container, stage } = mount(doc);
		const el = stage.el;
		assertEquals(mock.subscriberCount(), 1);

		stage.destroy();

		// unmounted
		assertEquals(container.querySelector(".mms-stage"), null);
		assertEquals(el.parentNode, null);

		// scanner untouched by stage teardown
		assertEquals(mock.calls.stop, 0);
		assertEquals(mock.calls.destroy, 0);
		assertEquals(mock.calls.setTorch, []);
		assertEquals(mock.calls.setCamera, []);

		// unsubscribed — later emissions don't touch the removed element
		assertEquals(mock.subscriberCount(), 0);
		mock.emit({ status: "scanning" });
		assertEquals(el.getAttribute("data-status"), "idle");

		// idempotent
		stage.destroy();
	});
});

Deno.test("stage: throws on missing container and on null video", () => {
	withDocument((doc) => {
		const mock = createMockScanner();

		assertThrows(
			() =>
				createScannerStage(
					mock.scanner,
					{} as unknown as ScannerStageOptions,
				),
			Error,
			"container",
		);

		mock.setVideo(null);
		const container = doc.createElement("div") as unknown as HTMLElement;
		assertThrows(
			() => createScannerStage(mock.scanner, { container }),
			Error,
			"video",
		);
	});
});
