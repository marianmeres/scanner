import { createDefaultDetector, toScanResult } from "./detector.ts";
import type { BarcodeFormat, Detector, DetectorSource, ScanResult } from "./types.ts";

/** Options for {@linkcode scanImage}. */
export interface ScanImageOptions {
	/** Formats to detect. Default `["qr_code"]`. */
	formats?: BarcodeFormat[];
	/** Decoding engine seam. Default wraps the `barcode-detector` ponyfill. */
	detector?: Detector;
	/** See {@linkcode ScannerConfig.wasmOverrides}. */
	wasmOverrides?: Record<string, unknown>;
}

/**
 * Decode barcodes from a still image — no camera involved. Useful for file
 * uploads, drag & drop, or as a fallback where `getUserMedia` is unavailable.
 *
 * Unlike the scanner instance methods (which never throw), this standalone
 * utility THROWS on fetch/decode failure. An image without any recognizable
 * code resolves with `[]` (not an error).
 *
 * ```ts
 * const results = await scanImage(file); // File | Blob | ImageData | <img> | url
 * if (results.length) console.log(results[0].value);
 * ```
 */
export async function scanImage(
	source: DetectorSource | string,
	options: ScanImageOptions = {},
): Promise<ScanResult[]> {
	const detector = options.detector ??
		createDefaultDetector({
			formats: options.formats,
			wasmOverrides: options.wasmOverrides,
		});

	let src: DetectorSource;
	if (typeof source === "string") {
		const resp = await fetch(source);
		if (!resp.ok) {
			throw new Error(`Failed to fetch image (${resp.status}): ${source}`);
		}
		src = await resp.blob();
	} else {
		src = source;
	}

	const detections = await detector.detect(src);
	const now = Date.now();
	return detections.map((d) => toScanResult(d, now));
}
