import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE || "playwright"
);
const origin = process.env.MOBILE_PREVIEW_ORIGIN || "http://127.0.0.1:52132";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [];
const errors = [];
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8P8AAAAASUVORK5CYII=",
	"base64",
);
const photo = (name = "screenshot.png") => ({
	name,
	mimeType: "image/png",
	buffer: png,
});
const context = await browser.newContext({
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
});
async function open(provider = "codex", init) {
	const page = await context.newPage();
	page.on("pageerror", (error) => errors.push(error.message));
	if (init) await page.addInitScript(init);
	await page.goto(`${origin}/?t=preview-token`);
	await page
		.getByRole("button", {
			name: provider === "codex" ? /GatedSpace mobile/ : /Filtrsoft/,
		})
		.click();
	return page;
}
async function settled(page) {
	await page.waitForFunction(() => !attachmentJob && !attachBtn.disabled);
}
const check = (name) => {
	checks.push(name);
	console.log(`PASS ${name}`);
};
try {
	await fetch(`${origin}/api/preview/reset`, {
		method: "POST",
		headers: { "x-bridge-token": "preview-token" },
	});
	for (const provider of ["codex", "claude"]) {
		const page = await open(provider);
		await page.locator("#file").setInputFiles(photo());
		await settled(page);
		assert.equal(await page.locator("#shelf .chip").count(), 1);
		await page
			.getByRole("button", { name: "Preview screenshot.png", exact: true })
			.click();
		await page.getByRole("dialog").waitFor();
		await page.getByRole("button", { name: "Close image" }).click();
		await page
			.getByRole("button", { name: "Remove screenshot.png", exact: true })
			.click();
		await page.locator("#file").setInputFiles(photo());
		await settled(page);
		const request = page.waitForRequest((r) =>
			r.url().endsWith(`/${provider}/${provider}/send`),
		);
		await page.getByRole("button", { name: "Send", exact: true }).click();
		const body = (await request).postDataJSON();
		assert.equal(body.text, "");
		assert.equal(body.images.length, 1);
		assert(body.images[0].data.length > 4);
		await page.waitForFunction(() => pending.length === 0);
		check(
			`${provider}: image selection, preview, remove, reselect and image-only send to fixture API`,
		);
		await page.close();
	}
	for (const fault of ["context", "draw", "encode"]) {
		const page = await open();
		await page.evaluate((kind) => {
			if (kind === "context")
				HTMLCanvasElement.prototype.getContext = () => null;
			if (kind === "draw")
				CanvasRenderingContext2D.prototype.drawImage = () => {
					throw new Error("Canvas memory exhausted");
				};
			if (kind === "encode")
				HTMLCanvasElement.prototype.toDataURL = () => "data:,";
		}, fault);
		await page.locator("#file").setInputFiles(photo());
		await settled(page);
		assert.equal(await page.locator("#shelf .chip").count(), 1);
		assert.equal(await page.evaluate(() => pending[0].mediaType), "image/png");
		check(`${fault} failure: supported original attaches and controls recover`);
		await page.close();
	}
	{
		const page = await open();
		const large = await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 4032;
			canvas.height = 3024;
			const ctx = canvas.getContext("2d");
			const gradient = ctx.createLinearGradient(0, 0, 4032, 3024);
			gradient.addColorStop(0, "#bd93f9");
			gradient.addColorStop(1, "#282a36");
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, 4032, 3024);
			const encoded = canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
			canvas.width = canvas.height = 0;
			return encoded;
		});
		await page.locator("#file").setInputFiles({
			name: "camera.jpg",
			mimeType: "image/jpeg",
			buffer: Buffer.from(large, "base64"),
		});
		await settled(page);
		assert.deepEqual(
			await page.evaluate(() => ({
				width: pending[0].width,
				height: pending[0].height,
			})),
			{ width: 1600, height: 1200 },
		);
		check("12 megapixel camera photo resizes to a readable 1600px attachment");
		await page.close();
	}
	{
		const page = await open();
		await page.locator("#file").setInputFiles([
			photo("first.png"),
			{
				name: "unreadable.heic",
				mimeType: "image/heic",
				buffer: Buffer.from("not an image"),
			},
			photo("last.png"),
		]);
		await settled(page);
		assert.equal(await page.locator("#shelf .chip").count(), 2);
		assert.match(await page.locator("#hint").innerText(), /unreadable.heic/);
		const box = await page.locator("#hint").boundingBox();
		assert(box && box.y >= 0 && box.y + box.height <= 844);
		await mkdir(".tmp/mobile-photo-check", { recursive: true });
		await page.screenshot({
			path: ".tmp/mobile-photo-check/partial-selection.png",
		});
		check(
			"one unreadable photo preserves the good selections and shows a visible error",
		);
		await page.close();
	}
	{
		const page = await open("codex", () => {
			window.photoMetrics = {
				reading: 0,
				peak: 0,
				resetEarly: false,
				canvases: [],
			};
			const read = FileReader.prototype.readAsDataURL;
			FileReader.prototype.readAsDataURL = function (file) {
				photoMetrics.reading++;
				photoMetrics.peak = Math.max(photoMetrics.peak, photoMetrics.reading);
				this.addEventListener("load", () => {
					if (!document.getElementById("file").files.length)
						photoMetrics.resetEarly = true;
				});
				this.addEventListener("loadend", () => {
					photoMetrics.reading--;
				});
				return read.call(this, file);
			};
			const create = document.createElement.bind(document);
			document.createElement = (name, options) => {
				const element = create(name, options);
				if (name === "canvas") photoMetrics.canvases.push(element);
				return element;
			};
		});
		await page
			.locator("#file")
			.setInputFiles(
				Array.from({ length: 6 }, (_, i) => photo(`photo-${i}.png`)),
			);
		await settled(page);
		const metrics = await page.evaluate(() => ({
			peak: photoMetrics.peak,
			resetEarly: photoMetrics.resetEarly,
			released: photoMetrics.canvases.every(
				(canvas) => canvas.width === 0 && canvas.height === 0,
			),
			count: pending.length,
			pickerReset: fileInput.value === "",
		}));
		assert.deepEqual(metrics, {
			peak: 1,
			resetEarly: false,
			released: true,
			count: 6,
			pickerReset: true,
		});
		check(
			"six photos read sequentially, keep the picker until read, and release all canvas backing stores",
		);
		await page.close();
	}
	for (const fault of ["reader", "timeout", "oversized"]) {
		const page = await open();
		await page.evaluate((kind) => {
			if (kind === "reader")
				FileReader.prototype.readAsDataURL = () => {
					throw new Error("Photo unavailable");
				};
			if (kind === "timeout") {
				FileReader.prototype.readAsDataURL = () => {};
				const schedule = window.setTimeout;
				window.setTimeout = (fn, ms, ...args) =>
					schedule(fn, ms === 30000 ? 20 : ms, ...args);
			}
			if (kind === "oversized")
				HTMLCanvasElement.prototype.getContext = () => null;
		}, fault);
		await page.locator("#file").setInputFiles(
			fault === "oversized"
				? {
						...photo(),
						buffer: Buffer.concat([png, Buffer.alloc(4_000_000)]),
					}
				: photo(),
		);
		await settled(page);
		assert.equal(await page.locator("#shelf .chip").count(), 0);
		assert(await page.locator("#hint").isVisible());
		assert.match(await page.locator("#hint").innerText(), /screenshot.png/);
		check(`${fault} failure shows an error and unlocks the picker`);
		await page.close();
	}
	{
		const page = await open();
		await page.evaluate(() => {
			const read = readImage;
			readImage = (file) =>
				new Promise((resolve) => setTimeout(() => resolve(read(file)), 1500));
		});
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.fill("Keep my draft");
		await page.locator("#file").setInputFiles(photo());
		assert(
			await page
				.getByRole("button", { name: "Send", exact: true })
				.isDisabled(),
		);
		await page.getByRole("button", { name: "Back", exact: true }).click();
		await page.getByRole("button", { name: /Filtrsoft/ }).click();
		assert.equal(await page.locator("#shelf .chip").count(), 0);
		await page.getByRole("button", { name: "Back", exact: true }).click();
		await page.getByRole("button", { name: /GatedSpace mobile/ }).click();
		await settled(page);
		assert.equal(await page.locator("#shelf .chip").count(), 1);
		assert.equal(
			await page
				.getByRole("textbox", { name: "Message", exact: true })
				.inputValue(),
			"Keep my draft",
		);
		check(
			"navigation during decoding keeps the photo in its original conversation and prevents premature sending",
		);
		await page.close();
	}
	assert.deepEqual(errors, []);
	check("no uncaught browser errors");
	await writeFile(
		".tmp/mobile-photo-check/results.json",
		JSON.stringify(
			{
				ok: true,
				checks,
				errors,
				scope:
					"Chromium mobile viewport with simulated APIs and injected browser failures; no physical iPhone or live provider messages.",
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
