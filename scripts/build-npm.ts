import { npmBuild, versionizeDeps } from "@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
	name: denoJson.name,
	version: denoJson.version,
	repository: denoJson.name.replace(/^@/, ""),
	entryPoints: ["mod", "stage"],
	dependencies: versionizeDeps(
		[
			"@marianmeres/clog",
			"@marianmeres/mediaperms",
			"@marianmeres/store",
			"barcode-detector",
		],
		denoJson,
	),
});
