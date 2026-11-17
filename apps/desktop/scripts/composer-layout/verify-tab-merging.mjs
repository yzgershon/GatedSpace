import assert from "node:assert/strict";

/** Real pointer gestures against TabRail + Workspace; provider calls are mocked. */
export async function verifyTabMerging({ page, electron, out }) {
	const original = await page.evaluate(() => {
		const { version, tabs, activeTabId } =
			window.layoutFixture.store.getState();
		return { version, tabs, activeTabId };
	});
	const reset = async (maximized = false, group = false) => {
		await page.evaluate(
			({ maximized, group }) => {
				const pane = (id, provider) => ({
					id,
					kind: "session",
					data: { provider, sessionId: `native-${id}` },
				});
				const target = pane("destination", "codex");
				const source = pane("incoming", "claude");
				const extra = pane("companion", "codex");
				window.layoutFixture.store.getState().replaceState({
					version: 1,
					activeTabId: "target",
					tabs: [
						{
							id: "target",
							titleOverride: "Destination",
							createdAt: 1,
							activePaneId: target.id,
							maximizedPaneId: maximized ? target.id : null,
							panes: { [target.id]: target },
							layout: { type: "pane", paneId: target.id },
						},
						{
							id: "source",
							titleOverride: "Incoming",
							createdAt: 2,
							activePaneId: source.id,
							panes: {
								[source.id]: source,
								...(group ? { [extra.id]: extra } : {}),
							},
							layout: group
								? {
										type: "split",
										direction: "vertical",
										splitPercentage: 40,
										first: { type: "pane", paneId: source.id },
										second: { type: "pane", paneId: extra.id },
									}
								: { type: "pane", paneId: source.id },
						},
					],
				});
			},
			{ maximized, group },
		);
		await page.locator('[data-pane-id="destination"]').waitFor();
	};
	const drag = async (edge) => {
		// Start on the agent image itself, as people do in the collapsed rail.
		const icon = page
			.getByRole("button", { name: "Incoming", exact: true })
			.locator("img");
		// Wait for the previous drop/cancel's settling animation before aiming
		// another gesture at the chip; raw coordinates bypass actionability.
		await icon.hover();
		const source = await icon.boundingBox();
		const target = await page
			.locator('[data-pane-id="destination"]')
			.boundingBox();
		const x =
			target.x +
			target.width * (edge === "left" ? 0.2 : edge === "right" ? 0.8 : 0.5);
		const y =
			target.y +
			target.height * (edge === "top" ? 0.2 : edge === "bottom" ? 0.8 : 0.5);
		await page.mouse.move(
			source.x + source.width / 2,
			source.y + source.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(x, y, { steps: 15 });
		await page.getByText("Merge group here", { exact: true }).waitFor();
	};
	for (const zoom of [1, 1.5]) {
		await electron.evaluate(
			({ BrowserWindow }, z) =>
				BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z),
			zoom,
		);
		for (const maximized of [false, true]) {
			for (const edge of ["left", "right", "top", "bottom"]) {
				await reset(maximized);
				await drag(edge);
				await page.mouse.up();
				await page.waitForFunction(
					() => document.querySelectorAll("[data-pane-id]").length === 2,
				);
				const state = await page.evaluate(() => {
					const { tabs, activeTabId } = window.layoutFixture.store.getState();
					return { tabs, activeTabId };
				});
				assert.equal(state.tabs.length, 1);
				assert.equal(state.activeTabId, "target");
				const tab = state.tabs[0];
				assert.equal(tab.maximizedPaneId, null);
				assert.equal(tab.activePaneId, "incoming");
				assert.equal(tab.panes.incoming.data.sessionId, "native-incoming");
				assert.equal(
					tab.panes.destination.data.sessionId,
					"native-destination",
				);
				assert.equal(
					tab.layout.direction,
					edge === "left" || edge === "right" ? "horizontal" : "vertical",
				);
				assert.equal(
					tab.layout.first.paneId,
					edge === "left" || edge === "top" ? "incoming" : "destination",
				);
				await page
					.getByText("Merge group here", { exact: true })
					.waitFor({ state: "hidden" });
				if (zoom === 1 && maximized && edge === "right")
					await page.screenshot({ path: `${out}/merged-expanded-pane.png` });
			}
		}
	}
	await reset(true, true);
	await drag("right");
	await page.mouse.up();
	await page.waitForFunction(
		() => document.querySelectorAll("[data-pane-id]").length === 3,
	);
	assert.deepEqual(
		await page.evaluate(
			() => window.layoutFixture.store.getState().tabs[0].layout.second,
		),
		{
			type: "split",
			direction: "vertical",
			splitPercentage: 40,
			first: { type: "pane", paneId: "incoming" },
			second: { type: "pane", paneId: "companion" },
		},
	);
	await reset();
	await drag("left");
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await page
		.getByText("Merge group here", { exact: true })
		.waitFor({ state: "hidden" });
	assert.equal(
		await page.evaluate(
			() => window.layoutFixture.store.getState().tabs.length,
		),
		2,
	);
	// Cancelling must not leave capture or the drag state stuck.
	await drag("right");
	await page.mouse.up();
	await page.waitForFunction(
		() => document.querySelectorAll("[data-pane-id]").length === 2,
	);
	await electron.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
	);
	await page.evaluate(
		(state) => window.layoutFixture.store.getState().replaceState(state),
		original,
	);
}
