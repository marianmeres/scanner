// deno-lint-ignore-file no-explicit-any
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import type {
	BarcodeFormat,
	DetectedBarcodeLike,
	Detector,
	DetectorSource,
	ScanResult,
} from "./types.ts";

/** Options for {@linkcode createDefaultDetector}. */
export interface CreateDefaultDetectorOptions {
	/** Formats to detect. Default `["qr_code"]`. */
	formats?: BarcodeFormat[];
	/**
	 * Overrides passed to zxing-wasm's `prepareZXingModule` — most notably
	 * `locateFile` for self-hosting the `.wasm` binary. See
	 * {@linkcode ScannerConfig.wasmOverrides}.
	 */
	wasmOverrides?: Record<string, unknown>;
}

/** Default formats — QR only (the fastest and the primary use case). */
export const DEFAULT_FORMATS: BarcodeFormat[] = ["qr_code"];

/**
 * Default {@linkcode Detector} wrapping the `barcode-detector` ponyfill
 * (zxing-cpp wasm engine, all major 1D/2D formats).
 *
 * NOTE: the ~1 MB decoder `.wasm` is fetched lazily (on first `detect()`)
 * from the jsDelivr CDN by default — pass `wasmOverrides.locateFile` to
 * self-host it.
 */
export function createDefaultDetector(
	options: CreateDefaultDetectorOptions = {},
): Detector {
	if (options.wasmOverrides) {
		prepareZXingModule({ overrides: options.wasmOverrides as any });
	}
	const detector = new BarcodeDetector({
		formats: (options.formats ?? DEFAULT_FORMATS) as any,
	});
	return {
		async detect(source: DetectorSource): Promise<DetectedBarcodeLike[]> {
			const detections = await detector.detect(source as any);
			return detections as unknown as DetectedBarcodeLike[];
		},
	};
}

/** Map a raw detection to the public {@linkcode ScanResult} shape. */
export function toScanResult(
	d: DetectedBarcodeLike,
	timestamp: number = Date.now(),
): ScanResult {
	return {
		value: d.rawValue,
		format: d.format as BarcodeFormat,
		cornerPoints: (d.cornerPoints ?? []).map((p) => ({ x: p.x, y: p.y })),
		boundingBox: d.boundingBox,
		timestamp,
	};
}
