# Example

Self-contained vanilla-JS demo of `@marianmeres/scanner` — live camera stage
(single/continuous mode, torch, camera switch) plus `scanImage` decode from an
uploaded image file.

## Build

Bundles `src/mod.ts` → `dist/bundle.js` and `src/stage.ts` → `dist/stage.js`
(via `jsr:@marianmeres/deno-build`):

```sh
deno task build:example
```

> NOTE: the task uses the bundler's `--esbuild` backend — the default
> pure-Deno backend cannot resolve the `npm:barcode-detector` dependency
> (it fails with `Module ... was an unsupported module kind`).

## Serve

Any static file server works, e.g.:

```sh
deno run -A jsr:@std/http/file-server example
# -> http://localhost:8000/index.html
```

> ⚠️ Camera access (`getUserMedia`) requires a **secure context** — HTTPS or
> `localhost`. To test on a phone, either serve over HTTPS (e.g. a tunnel like
> `cloudflared`/`ngrok`, or a local cert via `mkcert`) or use `adb reverse` /
> Safari remote debugging against `localhost`.

The zxing decoder `.wasm` (~1 MB) is fetched lazily from the jsDelivr CDN on
the first scan — so the very first decode needs network access (self-host via
the `wasmOverrides.locateFile` config).

## Svelte

[`svelte/ScannerStage.svelte`](./svelte/ScannerStage.svelte) — a reference
Svelte 5 (runes) wrapper component around the headless controller + DOM stage.
Not built or type-checked here (this repo has no Svelte build) — copy it into
a Svelte 5 app (e.g. `src/lib/`). Validated with the Svelte autofixer.
