/** Runs in an isolated Electron main process. Reads only checked-in screenshots;
 * creates no windows, captures no desktop and sends no input. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { app, nativeImage } from "electron";
import { prepareComputerImages } from "../src/main/lib/computer-use/image-quality";

async function main() {
	const root = resolve(process.cwd());
	const output = resolve(root, ".tmp/desktop-polish");
	await mkdir(output, { recursive: true });
	const samples = [];
	for (const file of ["hero-dracula.png", "live-code.png", "browser.png"]) {
		const png = await readFile(resolve(root, ".github/assets", file));
		const source = nativeImage.createFromBuffer(png);
		const start = performance.now();
		const result = prepareComputerImages(
			{
				content: [
					{
						type: "image",
						mimeType: "image/png",
						data: png.toString("base64"),
					},
				],
			},
			(input) => nativeImage.createFromBuffer(input).toJPEG(90),
		);
		const elapsedMs = performance.now() - start;
		const block = result.content[0];
		assert.equal(block.type, "image");
		if (block.type !== "image") throw new Error("Missing image");
		const bytes = Buffer.from(block.data, "base64");
		assert.deepEqual(
			nativeImage.createFromBuffer(bytes).getSize(),
			source.getSize(),
		);
		assert.ok(bytes.length <= png.length);
		if (block.mimeType === "image/png") assert.ok(bytes.equals(png));
		samples.push({
			file,
			...source.getSize(),
			originalBytes: png.length,
			deliveredBytes: bytes.length,
			mimeType: block.mimeType,
			elapsedMs,
		});
	}
	await writeFile(
		resolve(output, "image-quality.json"),
		JSON.stringify(
			{ scope: "Checked-in UI images; no live desktop capture", samples },
			null,
			2,
		),
	);
	console.log(JSON.stringify(samples, null, 2));
}
void main().then(
	() => app.exit(0),
	(error) => {
		console.error(error);
		app.exit(1);
	},
);
