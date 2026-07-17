// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { scanImage } from "../src/scan-image.ts";
import { createMockDetector, makeDetection } from "./_helpers.ts";

Deno.test("scanImage: maps detector output to ScanResult[]", async () => {
	const d1 = makeDetection("one");
	const d2 = makeDetection("two", "ean_13");
	const detector = createMockDetector([d1, d2]);
	const blob = new Blob(["fake-image-bytes"]);

	const before = Date.now();
	const results = await scanImage(blob, { detector });
	const after = Date.now();

	assertEquals(results.length, 2);
	assertEquals(results[0].value, "one");
	assertEquals(results[0].format, "qr_code");
	assertEquals(results[0].cornerPoints, [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	]);
	assertStrictEquals(results[0].boundingBox, d1.boundingBox); // passthrough
	assertEquals(results[1].value, "two");
	assertEquals(results[1].format, "ean_13");

	// one shared timestamp per call, within the call window
	assertEquals(results[0].timestamp, results[1].timestamp);
	assert(results[0].timestamp >= before && results[0].timestamp <= after);

	// blob source is passed to the detector untouched
	assertStrictEquals(detector.lastSource, blob);
	assertEquals(detector.detectCalls, 1);
});

Deno.test("scanImage: image without any recognizable code resolves []", async () => {
	const detector = createMockDetector([]);
	assertEquals(await scanImage(new Blob(["x"]), { detector }), []);
});

Deno.test("scanImage: throws when the detector throws", async () => {
	const detector = createMockDetector();
	detector.setDetectFn(() => Promise.reject(new Error("decode failed")));
	await assertRejects(
		() => scanImage(new Blob(["x"]), { detector }),
		Error,
		"decode failed",
	);
});

Deno.test("scanImage: string source is fetched and decoded as a Blob", async () => {
	const prevFetch = globalThis.fetch;
	const fetched: string[] = [];
	const body = new Blob(["img-bytes"]);
	(globalThis as any).fetch = (url: unknown) => {
		fetched.push(String(url));
		return Promise.resolve({
			ok: true,
			status: 200,
			blob: () => Promise.resolve(body),
		});
	};
	try {
		const detector = createMockDetector([makeDetection("from-url")]);
		const results = await scanImage("https://example.test/qr.png", { detector });
		assertEquals(fetched, ["https://example.test/qr.png"]);
		assertStrictEquals(detector.lastSource, body);
		assertEquals(results.length, 1);
		assertEquals(results[0].value, "from-url");
	} finally {
		globalThis.fetch = prevFetch;
	}
});

Deno.test("scanImage: non-ok fetch response throws (detector never called)", async () => {
	const prevFetch = globalThis.fetch;
	(globalThis as any).fetch = () => Promise.resolve({ ok: false, status: 404 });
	try {
		const detector = createMockDetector([makeDetection("nope")]);
		await assertRejects(
			() => scanImage("https://example.test/missing.png", { detector }),
			Error,
			"Failed to fetch image (404)",
		);
		assertEquals(detector.detectCalls, 0);
	} finally {
		globalThis.fetch = prevFetch;
	}
});

Deno.test("scanImage: fetch rejection propagates", async () => {
	const prevFetch = globalThis.fetch;
	(globalThis as any).fetch = () => Promise.reject(new TypeError("network down"));
	try {
		const detector = createMockDetector();
		await assertRejects(
			() => scanImage("https://example.test/qr.png", { detector }),
			TypeError,
			"network down",
		);
		assertEquals(detector.detectCalls, 0);
	} finally {
		globalThis.fetch = prevFetch;
	}
});
