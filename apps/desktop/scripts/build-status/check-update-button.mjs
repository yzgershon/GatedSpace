import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function checkUpdateButton(page, output) {
	const ready = () => page.getByRole("button", { name: "Update to 1.18.53" });
	const emit = (event) =>
		page.evaluate((state) => window.updatePreview.emit(state), event);
	const installs = () =>
		page.evaluate(
			() =>
				window.updatePreview.calls.filter((p) => p === "autoUpdate.install")
					.length,
		);

	// A public update completed before mounting, with no personal installer.
	await ready().waitFor();
	assert.equal((await ready().boundingBox()).width, 32);
	for (const status of ["idle", "checking", "updated"]) {
		await emit({ status });
		await ready().waitFor({ state: "hidden" });
		assert.equal(
			await page.getByRole("button", { name: /update/i }).count(),
			0,
		);
	}
	await emit({ status: "downloading", version: "1.18.53" });
	await page
		.getByRole("button", { name: "Downloading update 1.18.53", exact: true })
		.waitFor();
	await emit({
		status: "downloading",
		version: "1.18.53",
		progress: { percent: 42, transferredBytes: 42, totalBytes: 100 },
	});
	const download = page.getByRole("button", {
		name: "Downloading update 1.18.53 — 42%",
	});
	await download.waitFor();
	assert.equal(await download.getAttribute("aria-disabled"), "true");
	await download.focus();
	await page.keyboard.press("Enter");
	assert.equal(await installs(), 0, "Cannot install an incomplete download");
	await page.screenshot({ path: resolve(output, "update-downloading.png") });

	await emit({ status: "ready", version: "1.18.53" });
	await page.evaluate(() => {
		window.updatePreview.busySessions = 2;
	});
	await ready().click();
	await page.getByRole("alertdialog").waitFor();
	assert.equal(await page.getByText("2 sessions are still working").count(), 1);
	await page.getByRole("button", { name: "Wait", exact: true }).click();
	assert.equal(await installs(), 0, "Wait leaves sessions alone");
	await ready().click();
	await page.getByRole("button", { name: "Install anyway" }).click();
	await page.getByRole("button", { name: "Installing update…" }).waitFor();
	assert.equal(
		await installs(),
		1,
		"Public update uses the shared install endpoint",
	);
	assert.equal(
		await page.getByRole("button", { name: "Installing update…" }).isDisabled(),
		true,
	);
	await page.screenshot({ path: resolve(output, "update-installing.png") });

	// A failed install can recover; retry never bypasses the main updater.
	await emit({ status: "error", error: "Download interrupted" });
	const retry = page.getByRole("button", { name: "Retry update" });
	await retry.click();
	assert.equal(
		await page.evaluate(() =>
			window.updatePreview.calls.includes("autoUpdate.check"),
		),
		true,
	);
	await emit({ status: "ready", version: "1.18.53" });
	await page.evaluate(() => {
		window.updatePreview.busySessions = 0;
		window.updatePreview.failInstall = true;
	});
	await ready().click();
	await ready().waitFor();
	assert.equal(
		await installs(),
		2,
		"Idle sessions need no confirmation and IPC failure permits retry",
	);
	assert.equal(await page.getByRole("alertdialog").count(), 0);
	await page.evaluate(() => {
		window.updatePreview.failInstall = false;
	});
	await ready().click();
	await page.getByRole("button", { name: "Installing update…" }).waitFor();
	assert.equal(await installs(), 3);
	assert.equal(
		await page.evaluate(() =>
			window.updatePreview.calls.some(
				(p) => p === "autoUpdate.installPersonal",
			),
		),
		false,
	);

	await emit({ status: "idle" });
	await page
		.getByRole("button", { name: "Installing update…" })
		.waitFor({ state: "hidden" });
	await emit({ status: "ready", version: "1.18.53" });
	await ready().waitFor();
	return [
		"public ready on mount without a personal installer",
		"hidden when current or checking",
		"live download progress and install gating",
		"active-session confirmation and cancellation",
		"shared installation with duplicate-click latch",
		"update retry and IPC failure recovery",
	];
}
