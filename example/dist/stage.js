// src/stage.ts
var STYLE_ID = "mms-styles";
var FLASH_MS = 400;
var ICONS = {
  cancel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  torch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/></svg>`,
  switch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h4M21 16v-4h-4"/><path d="M3.5 12a8.5 8.5 0 0 1 14.9-4.5M20.5 12a8.5 8.5 0 0 1-14.9 4.5"/></svg>`
};
var CSS = `
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
function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}
function resolveTheme(theme) {
  if (theme !== "auto") return theme;
  try {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch (_e) {
    return "dark";
  }
}
function setHidden(el, hidden) {
  if (hidden) el.setAttribute("hidden", "");
  else el.removeAttribute("hidden");
}
function button(doc, cls, label, icon) {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = `mms-btn ${cls}`;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = icon;
  return btn;
}
function createScannerStage(scanner, options) {
  const container = options?.container;
  if (!container) throw new Error("options.container is required");
  const doc = container.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("createScannerStage requires a DOM environment");
  const video = scanner.getVideo();
  if (!video) {
    throw new Error("Scanner could not provide a video element");
  }
  ensureStyles(doc);
  const controls = { cancel: true, ...options.controls };
  const cleanups = [];
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
  let cancelBtn = null;
  let torchBtn = null;
  let switchBtn = null;
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
  if ((options.theme ?? "auto") === "auto") {
    try {
      const mq = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
      const onChange = () => {
        el.setAttribute("data-theme", mq?.matches ? "dark" : "light");
      };
      mq?.addEventListener?.("change", onChange);
      if (mq) cleanups.push(() => mq.removeEventListener?.("change", onChange));
    } catch (_e) {
    }
  }
  let flashTimer = null;
  let lastFlashTs = 0;
  const unsub = scanner.subscribe((state) => {
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
  let containerPositionSet = false;
  try {
    const computed = globalThis.getComputedStyle?.(container)?.position;
    const pos = computed ?? container.style?.position;
    if (!pos || pos === "static") {
      container.style.position = "relative";
      containerPositionSet = true;
    }
  } catch (_e) {
  }
  container.appendChild(el);
  return {
    el,
    destroy() {
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch (_e) {
        }
      });
      cleanups.length = 0;
      if (containerPositionSet) {
        try {
          container.style.position = "";
        } catch (_e) {
        }
      }
      el.remove();
    }
  };
}
export {
  createScannerStage
};
