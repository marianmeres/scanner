<!--
	Sample Svelte 5 wrapper around the framework-agnostic scanner primitive:
	headless `createScanner` (mod) + DOM `createScannerStage` (stage subpath).

	The scanner/stage are configured ONCE at mount (mode/formats/controls don't
	change mid-life; remount with `{#key ...}` if you need to). Callbacks are
	wrapped so the latest prop is invoked. Reactive scanner state is bridged
	into runes via `fromStore` (the scanner implements the Svelte store
	contract).

	Scanning never auto-starts (user-gesture / permission-prompt rules, esp.
	iOS Safari) — call the exported `start()` from a click handler, e.g. via
	`bind:this={stageRef}` and `stageRef.start()`.

	This file is reference material — the scanner repo itself has no Svelte
	build. Copy it into a Svelte 5 app (e.g. `src/lib/`).
-->
<script lang="ts">
	import { untrack } from "svelte";
	import { fromStore } from "svelte/store";
	import {
		type BarcodeFormat,
		createScanner,
		type ScanMode,
		type ScannerError,
		type ScanResult,
	} from "@marianmeres/scanner";
	import {
		createScannerStage,
		type ScannerStageTheme,
	} from "@marianmeres/scanner/stage";

	let {
		mode = "single",
		formats = ["qr_code"],
		preferredCamera = "environment",
		controls = { cancel: true, torch: true, cameraSwitch: true },
		theme = "auto",
		accent,
		onscan,
		onerror,
		oncancel,
	}: {
		/** `"single"` (default) auto-stops on first hit; `"continuous"` keeps going. */
		mode?: ScanMode;
		/** Barcode formats to detect. Default `["qr_code"]`. */
		formats?: BarcodeFormat[];
		/** `"environment"` (default) / `"user"` facing hint, or a concrete deviceId. */
		preferredCamera?: string;
		/** Which built-in stage buttons to render (unsupported ones auto-hide). */
		controls?: { cancel?: boolean; torch?: boolean; cameraSwitch?: boolean };
		theme?: ScannerStageTheme;
		/** Accent color (CSS color value). */
		accent?: string;
		/** Fired for every successful detection. */
		onscan?: (result: ScanResult) => void;
		/** Fired whenever an error lands in the scanner state. */
		onerror?: (error: ScannerError) => void;
		/** Fired after the built-in cancel button stopped the scanner. */
		oncancel?: () => void;
	} = $props();

	let container: HTMLElement;

	// Configured once at mount; untrack reads the initial config. Callback
	// props stay live because they are invoked through closures.
	const scanner = untrack(() =>
		createScanner({
			mode,
			formats,
			preferredCamera,
			onScan: (r) => onscan?.(r),
			onError: (e) => onerror?.(e),
		})
	);

	// The scanner satisfies the Svelte store contract → bridge it into runes.
	const store = fromStore(scanner);
	const state = $derived(store.current);

	$effect(() => {
		const stage = untrack(() =>
			createScannerStage(scanner, {
				container,
				controls,
				theme,
				accent,
				onCancel: () => oncancel?.(),
			})
		);
		return () => {
			stage.destroy();
			scanner.destroy();
		};
	});

	// --- public api (usable via `bind:this`) --------------------------------

	/** Acquire the camera & start scanning. See `Scanner.start()` semantics. */
	export function start(): Promise<ScanResult | null> {
		return scanner.start();
	}

	/** Cancel scanning, release the camera. */
	export function stop(): void {
		scanner.stop();
	}

	/** Escape hatch to the full headless controller (torch, camera switch, ...). */
	export function getScanner() {
		return scanner;
	}
</script>

<div class="wrap">
	<div class="stage" bind:this={container}></div>
	{#if state.error}
		<p class="error">{state.error.code}: {state.error.message}</p>
	{/if}
	{#if state.permission === "denied"}
		<p class="error">
			Camera permission denied — re-enable it in the browser settings.
		</p>
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stage {
		width: 100%;
		height: min(55vh, 420px);
		border-radius: 0.5rem;
		overflow: hidden;
		background: #000;
	}
	.error {
		margin: 0;
		font-size: 0.85rem;
		color: #c1121f;
	}
</style>
