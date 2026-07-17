// deno-lint-ignore-file no-explicit-any
import {
	createCamPerms,
	type MediaPerms,
	type MediaPermsConfig,
} from "@marianmeres/mediaperms";
import type {
	CameraAdapter,
	CameraFacing,
	CameraInfo,
	CameraPermissionStatus,
} from "./types.ts";

const _g: any = globalThis;

/** Best-effort facing detection from a device label. */
export function detectFacing(label: string): CameraFacing | null {
	if (/back|rear|environment/i.test(label)) return "environment";
	// NOTE: no bare "face" — it would match "facing" (e.g. "camera 2, facing external")
	if (/front|user|facetime|selfie/i.test(label)) return "user";
	return null;
}

function mediaDevices(): MediaDevices | null {
	return _g?.navigator?.mediaDevices ?? null;
}

/** Options for {@linkcode createDefaultCameraAdapter}. */
export interface CreateDefaultCameraAdapterOptions {
	/**
	 * Share an existing `@marianmeres/mediaperms` instance (camera kind).
	 * When omitted, the adapter lazily creates its own via `createCamPerms()`
	 * and destroys it in {@linkcode CameraAdapter.destroy}. Pass a shared
	 * instance when the app already manages one (it will NOT be destroyed by
	 * the adapter).
	 */
	perms?: MediaPerms;
	/**
	 * Config forwarded to `createCamPerms()` when the adapter creates its own
	 * instance (platform hints, webview bridges, logger...). Ignored when
	 * {@linkcode CreateDefaultCameraAdapterOptions.perms} is provided.
	 */
	permsConfig?: MediaPermsConfig;
}

/**
 * Default {@linkcode CameraAdapter}.
 *
 * Stream acquisition and device enumeration wrap `navigator.mediaDevices`
 * directly (the scanner needs to RETAIN the stream — deliberately out of
 * mediaperms' scope). The permission lifecycle (query + change tracking,
 * incl. Android-WebView sticky-denial coercion and bfcache/app-resume
 * rechecks) is delegated to `@marianmeres/mediaperms`.
 */
export function createDefaultCameraAdapter(
	options: CreateDefaultCameraAdapterOptions = {},
): CameraAdapter {
	let perms: MediaPerms | null = options.perms ?? null;
	let ownsPerms = false;
	let destroyed = false;

	function getPerms(): MediaPerms {
		if (!perms) {
			perms = createCamPerms(options.permsConfig);
			ownsPerms = true;
		}
		return perms;
	}

	return {
		getStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
			const md = mediaDevices();
			if (!md?.getUserMedia) {
				const err = new Error("navigator.mediaDevices.getUserMedia unavailable");
				err.name = "NotSupportedError";
				return Promise.reject(err);
			}
			return md.getUserMedia(constraints);
		},

		async enumerateVideoDevices(): Promise<CameraInfo[]> {
			const md = mediaDevices();
			if (!md?.enumerateDevices) return [];
			const devices = await md.enumerateDevices();
			return devices
				.filter((d) => d.kind === "videoinput")
				.map((d) => ({
					deviceId: d.deviceId,
					label: d.label ?? "",
					facing: detectFacing(d.label ?? ""),
				}));
		},

		async queryPermission(): Promise<CameraPermissionStatus | null> {
			if (destroyed) return null;
			try {
				const status = await getPerms().check();
				// "unknown" carries no information for the scanner — treat as
				// "could not determine" so the scanner keeps its own state
				return status === "unknown" ? null : status;
			} catch (_e) {
				return null;
			}
		},

		onPermissionChange(
			cb: (status: CameraPermissionStatus) => void,
		): (() => void) | null {
			if (destroyed) return null;
			// mediaperms subscribe fires immediately — skip that first emission
			// (queryPermission covers the initial value) and forward changes only
			let last: CameraPermissionStatus | null = null;
			let first = true;
			return getPerms().subscribe((s) => {
				const status = s.status as CameraPermissionStatus;
				if (!first && status !== last) cb(status);
				first = false;
				last = status;
			});
		},

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			if (ownsPerms) perms?.destroy();
			perms = null;
		},
	};
}
