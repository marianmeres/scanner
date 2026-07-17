/**
 * Framework-agnostic DOM "stage" for the scanner — a mountable camera
 * preview with the typical scanning UX: dimmed overlay with a viewfinder
 * cutout, corner guides, optional scan-line animation and opt-in control
 * buttons (cancel / torch / camera switch).
 *
 * The stage is a pure consumer of the headless {@linkcode Scanner} — it
 * renders its video element and reflects its reactive state. Destroying the
 * stage does NOT stop or destroy the scanner (and vice versa).
 *
 * @module
 */

import type { Scanner, ScannerState } from "./types.ts";

/** Stage color theme. `"auto"` follows `prefers-color-scheme`. */
export type ScannerStageTheme = "auto" | "light" | "dark";

/** Options for {@linkcode createScannerStage}. */
export interface ScannerStageOptions {
	/** Element to mount the stage into (its position will be set to relative). */
	container: HTMLElement;
	/**
	 * Which built-in control buttons to render. Buttons for unsupported
	 * features hide automatically (torch without capability, camera switch
	 * with a single camera). Default: `{ cancel: true }`.
	 */
	controls?: { cancel?: boolean; torch?: boolean; cameraSwitch?: boolean };
	/** Render the animated scan line inside the viewfinder. Default `true`. */
	scanLine?: boolean;
	/** Color theme. Default `"auto"`. */
	theme?: ScannerStageTheme;
	/** Accent color (CSS color value) — sets `--mms-accent`. */
	accent?: string;
	/** Called after the built-in cancel button stopped the scanner. */
	onCancel?: () => void;
}

/** Handle returned by {@linkcode createScannerStage}. */
export interface ScannerStage {
	/** The stage root element (already mounted into the container). */
	el: HTMLElement;
	/** Unmount and release stage resources. Does NOT touch the scanner. */
	destroy(): void;
}

const STYLE_ID = "mms-styles";
const FLASH_MS = 400;

const ICONS = {
	cancel:
		`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
	torch:
		`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/></svg>`,
	switch:
		`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h4M21 16v-4h-4"/><path d="M3.5 12a8.5 8.5 0 0 1 14.9-4.5M20.5 12a8.5 8.5 0 0 1-14.9 4.5"/></svg>`,
} as const;

const CSS = `
.mms-stage {
	position: relative;
	overflow: hidden;
	width: 100%;
	height: 100%;
	min-height: 200px;
	background: #000;
	border-radius: var(--mms-radius, 0);
	--mms-dim: rgba(0, 0, 0, 0.55);
	--mms-accent: #3b82f6;
	--mms-success: #22c55e;
	--mms-corner-color: rgba(255, 255, 255, 0.9);
	--mms-corner-size: 26px;
	--mms-corner-width: 4px;
	--mms-frame-size: min(65%, 65vmin);
	--mms-btn-bg: rgba(0, 0, 0, 0.5);
	--mms-btn-fg: #fff;
}
.mms-stage[data-theme="light"] {
	--mms-btn-bg: rgba(255, 255, 255, 0.7);
	--mms-btn-fg: #111;
}
.mms-video {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.mms-overlay {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	pointer-events: none;
}
.mms-frame {
	position: relative;
	width: var(--mms-frame-size);
	aspect-ratio: 1 / 1;
	border-radius: 12px;
	/* the dim around the cutout */
	box-shadow: 0 0 0 200vmax var(--mms-dim);
	transition: box-shadow 0.2s;
}
.mms-corner {
	position: absolute;
	width: var(--mms-corner-size);
	height: var(--mms-corner-size);
	border: 0 solid var(--mms-corner-color);
	transition: border-color 0.2s;
}
.mms-corner--tl { top: 0; left: 0; border-top-width: var(--mms-corner-width); border-left-width: var(--mms-corner-width); border-top-left-radius: 12px; }
.mms-corner--tr { top: 0; right: 0; border-top-width: var(--mms-corner-width); border-right-width: var(--mms-corner-width); border-top-right-radius: 12px; }
.mms-corner--bl { bottom: 0; left: 0; border-bottom-width: var(--mms-corner-width); border-left-width: var(--mms-corner-width); border-bottom-left-radius: 12px; }
.mms-corner--br { bottom: 0; right: 0; border-bottom-width: var(--mms-corner-width); border-right-width: var(--mms-corner-width); border-bottom-right-radius: 12px; }
.mms-scanline {
	position: absolute;
	left: 6%;
	right: 6%;
	top: 10%;
	height: 2px;
	border-radius: 1px;
	background: var(--mms-accent);
	box-shadow: 0 0 8px var(--mms-accent);
	opacity: 0;
}
.mms-stage[data-status="scanning"] .mms-scanline {
	opacity: 0.9;
	animation: mms-scan 2.2s ease-in-out infinite;
}
@keyframes mms-scan {
	0%, 100% { top: 10%; }
	50% { top: calc(90% - 2px); }
}
@media (prefers-reduced-motion: reduce) {
	.mms-stage[data-status="scanning"] .mms-scanline { animation: none; top: 49%; }
}
.mms-stage.mms-flash .mms-corner { border-color: var(--mms-success); }
.mms-stage.mms-flash .mms-frame {
	box-shadow: 0 0 0 200vmax var(--mms-dim), inset 0 0 24px var(--mms-success);
}
.mms-controls button {
	position: absolute;
	z-index: 2;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	padding: 10px;
	border: 0;
	border-radius: 50%;
	background: var(--mms-btn-bg);
	color: var(--mms-btn-fg);
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
}
.mms-controls button:active { transform: scale(0.94); }
.mms-controls button svg { width: 100%; height: 100%; }
.mms-controls [hidden] { display: none; }
.mms-btn-cancel { top: 12px; right: 12px; }
.mms-btn-torch { bottom: 12px; left: 12px; }
.mms-btn-torch[aria-pressed="true"] {
	background: var(--mms-accent);
	color: #fff;
}
.mms-btn-switch { bottom: 12px; right: 12px; }
`;

function ensureStyles(doc: Document): void {
	// per-document — a stage mounted into an iframe/popup needs the CSS in
	// ITS document, not the opener's
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = CSS;
	doc.head.appendChild(style);
}

function resolveTheme(theme: ScannerStageTheme): "light" | "dark" {
	if (theme !== "auto") return theme;
	try {
		return globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches
			? "dark"
			: "light";
	} catch (_e) {
		return "dark";
	}
}

function setHidden(el: HTMLElement, hidden: boolean): void {
	if (hidden) el.setAttribute("hidden", "");
	else el.removeAttribute("hidden");
}

function button(
	doc: Document,
	cls: string,
	label: string,
	icon: string,
): HTMLButtonElement {
	const btn = doc.createElement("button");
	btn.type = "button";
	btn.className = `mms-btn ${cls}`;
	btn.setAttribute("aria-label", label);
	btn.innerHTML = icon;
	return btn;
}

/**
 * Mount the scanning stage UI into `options.container`.
 *
 * ```ts
 * const scanner = createScanner();
 * const stage = createScannerStage(scanner, { container: el });
 * const result = await scanner.start();
 * stage.destroy();
 * ```
 *
 * Styling is themable via scoped CSS custom properties (`--mms-*`), e.g.
 * `--mms-accent`, `--mms-dim`, `--mms-frame-size`, `--mms-radius`.
 */
export function createScannerStage(
	scanner: Scanner,
	options: ScannerStageOptions,
): ScannerStage {
	const container = options?.container;
	if (!container) throw new Error("options.container is required");
	// derive the document from the mount point — supports iframes/popups
	const doc: Document | null = container.ownerDocument ??
		(typeof document !== "undefined" ? document : null);
	if (!doc) throw new Error("createScannerStage requires a DOM environment");

	const video = scanner.getVideo();
	if (!video) {
		throw new Error("Scanner could not provide a video element");
	}

	ensureStyles(doc);

	const controls = { cancel: true, ...options.controls };
	const cleanups: (() => void)[] = [];

	// --- dom ----------------------------------------------------------------
	const el = doc.createElement("div");
	el.className = "mms-stage";
	el.setAttribute("data-theme", resolveTheme(options.theme ?? "auto"));
	if (options.accent) el.style.setProperty("--mms-accent", options.accent);

	video.classList.add("mms-video");
	el.appendChild(video);

	const overlay = doc.createElement("div");
	overlay.className = "mms-overlay";
	const frame = doc.createElement("div");
	frame.className = "mms-frame";
	for (const pos of ["tl", "tr", "bl", "br"]) {
		const corner = doc.createElement("span");
		corner.className = `mms-corner mms-corner--${pos}`;
		frame.appendChild(corner);
	}
	if (options.scanLine ?? true) {
		const line = doc.createElement("div");
		line.className = "mms-scanline";
		frame.appendChild(line);
	}
	overlay.appendChild(frame);
	el.appendChild(overlay);

	const controlsEl = doc.createElement("div");
	controlsEl.className = "mms-controls";
	let cancelBtn: HTMLButtonElement | null = null;
	let torchBtn: HTMLButtonElement | null = null;
	let switchBtn: HTMLButtonElement | null = null;

	if (controls.cancel) {
		cancelBtn = button(doc, "mms-btn-cancel", "Cancel scanning", ICONS.cancel);
		cancelBtn.addEventListener("click", () => {
			scanner.stop();
			options.onCancel?.();
		});
		controlsEl.appendChild(cancelBtn);
	}
	if (controls.torch) {
		torchBtn = button(doc, "mms-btn-torch", "Toggle flashlight", ICONS.torch);
		setHidden(torchBtn, true);
		torchBtn.addEventListener("click", () => {
			void scanner.setTorch(!scanner.get().torch.on);
		});
		controlsEl.appendChild(torchBtn);
	}
	if (controls.cameraSwitch) {
		switchBtn = button(doc, "mms-btn-switch", "Switch camera", ICONS.switch);
		setHidden(switchBtn, true);
		switchBtn.addEventListener("click", () => {
			const { cameras, activeCameraId } = scanner.get();
			if (cameras.length < 2) return;
			const idx = cameras.findIndex((c) => c.deviceId === activeCameraId);
			const next = cameras[(idx + 1) % cameras.length];
			void scanner.setCamera(next.deviceId);
		});
		controlsEl.appendChild(switchBtn);
	}
	el.appendChild(controlsEl);

	// --- theme (auto) ---------------------------------------------------------
	if ((options.theme ?? "auto") === "auto") {
		try {
			const mq = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
			const onChange = () => {
				el.setAttribute("data-theme", mq?.matches ? "dark" : "light");
			};
			mq?.addEventListener?.("change", onChange);
			if (mq) cleanups.push(() => mq.removeEventListener?.("change", onChange));
		} catch (_e) {
			/* noop */
		}
	}

	// --- reactive wiring ------------------------------------------------------
	let flashTimer: ReturnType<typeof setTimeout> | null = null;
	let lastFlashTs = 0;

	const unsub = scanner.subscribe((state: ScannerState) => {
		el.setAttribute("data-status", state.status);

		if (torchBtn) {
			setHidden(torchBtn, !state.torch.supported);
			torchBtn.setAttribute("aria-pressed", String(state.torch.on));
		}
		if (switchBtn) setHidden(switchBtn, state.cameras.length < 2);

		if (state.lastResult && state.lastResult.timestamp !== lastFlashTs) {
			lastFlashTs = state.lastResult.timestamp;
			el.classList.add("mms-flash");
			if (flashTimer) clearTimeout(flashTimer);
			flashTimer = setTimeout(() => el.classList.remove("mms-flash"), FLASH_MS);
		}
	});
	cleanups.push(unsub);
	cleanups.push(() => {
		if (flashTimer) clearTimeout(flashTimer);
	});

	// --- mount ----------------------------------------------------------------
	// the stage is absolutely positioned inside the container — make sure the
	// container establishes a positioning context (computed style respected,
	// reverted on destroy if we set it)
	let containerPositionSet = false;
	try {
		const computed = globalThis.getComputedStyle?.(container)?.position;
		const pos = computed ?? container.style?.position;
		if (!pos || pos === "static") {
			container.style.position = "relative";
			containerPositionSet = true;
		}
	} catch (_e) {
		/* non-browser DOM without style support — leave positioning to the app */
	}
	container.appendChild(el);

	return {
		el,
		destroy(): void {
			cleanups.forEach((fn) => {
				try {
					fn();
				} catch (_e) {
					/* noop */
				}
			});
			cleanups.length = 0;
			if (containerPositionSet) {
				try {
					container.style.position = "";
				} catch (_e) {
					/* noop */
				}
			}
			el.remove();
		},
	};
}
