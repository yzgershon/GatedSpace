const assert = require("node:assert/strict");

module.exports = async ({ win, run, click, wait, capture, pass }) => {
	const rect = (selector) =>
		run(
			`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error('Missing ${selector}'); const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; })()`,
		);
	const state = () =>
		run("JSON.parse(JSON.stringify(toolsTest.tools.state.getState()))");
	const initialLayout = await run("toolsTest.main.getState().tabs[0].layout");
	await run(
		'toolsTest.tools.setOpen("right",true);toolsTest.tools.setOpen("bottom",true)',
	);
	await wait();
	const before = await state();
	const root = await rect(".gs-tool-workspace");
	await click('[data-pane-id="session-b"] [aria-label="Expand pane"]');
	await wait();
	const main = await rect(".gs-tool-main");
	const pane = await rect('[data-pane-id="session-b"]');
	assert.ok(Math.abs(main.width - root.width) < 1);
	assert.ok(Math.abs(main.height - root.height) < 1);
	// Same two 9px insets as a normal single pane, at the fixture's 85% scale.
	assert.ok(Math.abs(pane.x - root.x - 18 * 0.85) < 1);
	assert.ok(Math.abs(pane.y - root.y - 18 * 0.85) < 1);
	assert.equal(
		await run('document.querySelector(".gs-tool-slot-right").inert'),
		true,
	);
	assert.equal(
		await run(
			'getComputedStyle(document.querySelector(".gs-tool-slot-right")).visibility',
		),
		"hidden",
	);
	assert.equal(
		await run('document.querySelector(".gs-tool-slot-bottom").inert'),
		true,
	);
	await capture("main-expanded");
	await click('[data-pane-id="session-b"] [aria-label="Restore pane"]');
	await wait();
	const after = await state();
	assert.deepEqual(after.right, before.right);
	assert.deepEqual(after.bottom, before.bottom);
	assert.deepEqual(
		await run("toolsTest.main.getState().tabs[0].layout"),
		initialLayout,
	);
	pass(
		"Main expand fills right and bottom tool space; restore preserves panel sizes and split layout",
	);

	// Grab seven CSS pixels off centre: the old six-pixel divider could not hit this.
	for (const side of ["right", "bottom"]) {
		const selector = `.gs-tool-resize-${side}`;
		const handle = await rect(selector);
		const expectedSize = (await state())[side].size;
		const point = {
			x: handle.x + handle.width / 2,
			y: handle.y + handle.height / 2,
		};
		if (side === "right") point.x += 7 * 0.85;
		else point.y += 7 * 0.85;
		assert.ok(
			(side === "right" ? handle.width : handle.height) >= 20 * 0.85 - 0.5,
		);
		assert.equal(
			await run(
				`document.elementFromPoint(${point.x},${point.y}).classList.contains('gs-tool-resize')`,
			),
			true,
		);
		const panel = await rect(`.gs-tool-slot-${side} .gs-tool-panel`);
		if (side === "right") assert.ok(handle.right <= panel.x + 1);
		else assert.ok(handle.bottom <= panel.y + 1);
		for (const [type, offset] of [
			["mouseMoved", 0],
			["mousePressed", 0],
			["mouseMoved", -68],
			["mouseReleased", -68],
		]) {
			await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
				type,
				x: point.x + (side === "right" ? offset : 0),
				y: point.y + (side === "bottom" ? offset : 0),
				button: type === "mouseMoved" ? "none" : "left",
				buttons: type === "mouseReleased" ? 0 : 1,
				clickCount: 1,
			});
			await wait(40);
		}
		await wait();
		assert.ok(
			Math.abs((await state())[side].size - expectedSize - 80) < 2,
			`${side} drag size`,
		);
		assert.equal(
			await run(
				'document.querySelector(".gs-tool-workspace-resizing") === null',
			),
			true,
		);
		await run(`document.querySelector('${selector}').focus()`);
		await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: side === "right" ? "ArrowLeft" : "ArrowUp",
			windowsVirtualKeyCode: side === "right" ? 37 : 38,
		});
		await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: side === "right" ? "ArrowLeft" : "ArrowUp",
			windowsVirtualKeyCode: side === "right" ? 37 : 38,
		});
		assert.ok(Math.abs((await state())[side].size - expectedSize - 100) < 2);
		await wait();
		pass(
			`${side} divider has a neutral 20px target in the gutter; offset drag and keyboard resizing work at 85% zoom`,
		);
	}
	await capture("resize-handles");
	await run(
		'toolsTest.tools.setOpen("right",false);toolsTest.tools.setOpen("bottom",false)',
	);
	await wait();
	await run(
		'toolsTest.main.getState().closePane({tabId:"main",paneId:"session-a"})',
	);
	await wait();
	const normal = await rect('[data-pane-id="session-b"]');
	await click('[data-pane-id="session-b"] [aria-label="Expand pane"]');
	await wait();
	const expanded = await rect('[data-pane-id="session-b"]');
	for (const key of Object.keys(normal))
		assert.ok(Math.abs(expanded[key] - normal[key]) < 0.1, key);
	await click('[data-pane-id="session-b"] [aria-label="Restore pane"]');
	pass("Expanding a lone main pane does not change its size or padding");
	await wait();
	for (const provider of ["codex", "claude"]) {
		await click('[data-pane-id="session-b"] [aria-label="New pane"]');
		await wait();
		const chooser = await run(
			'Object.values(toolsTest.main.getState().getTab("main").panes).find(p=>p.kind==="new-tab").id',
		);
		await run(
			`document.querySelectorAll('[data-pane-id="${chooser}"] button').forEach(e=>{if(e.textContent.trim()===${JSON.stringify(provider)})e.dataset.testAgent='true'})`,
		);
		await click("[data-test-agent]");
		await wait();
		await run(
			`document.querySelectorAll('[role="menuitem"]').forEach(e=>{if(e.textContent.includes('Session pane'))e.dataset.testSession='true'})`,
		);
		await click("[data-test-session]");
		await wait();
		const result = await run(
			`(()=>{const s=toolsTest.main.getState(),t=s.getTab('main');return {count:s.tabs.length,panes:Object.values(t.panes),active:t.activePaneId}})()`,
		);
		assert.equal(result.count, 1);
		assert.equal(result.panes.length, 2);
		assert.equal(
			result.panes.find((p) => p.id === result.active).data.provider,
			provider,
		);
		assert.ok(!result.panes.some((p) => p.id === chooser));
		await run(
			`toolsTest.main.getState().closePane({tabId:'main',paneId:${JSON.stringify(result.active)}})`,
		);
		await wait();
		pass(
			`Pane-header + then ${provider} fills the existing slot without another tab`,
		);
	}
	await click('[data-pane-id="session-b"] [aria-label="New pane"]');
	await wait();
	const chooser = await run(
		'Object.values(toolsTest.main.getState().getTab("main").panes).find(p=>p.kind==="new-tab").id',
	);
	await run(
		`document.querySelectorAll('[data-pane-id="${chooser}"] button').forEach(e=>{if(e.textContent.trim()==='Terminal')e.dataset.testTerminal='true'})`,
	);
	await click("[data-test-terminal]");
	await click("[data-test-terminal]");
	assert.equal(await run("toolsTest.launcherControl.count"), 1);
	assert.equal(
		await run(`toolsTest.main.getState().getPane('${chooser}')!==null`),
		true,
	);
	await run("toolsTest.launcherControl.fail()");
	await wait();
	assert.equal(
		await run('document.querySelector("[role=alert]").textContent'),
		"Fixture creation failure",
	);
	await click("[data-test-terminal]");
	assert.equal(await run("toolsTest.launcherControl.count"), 2);
	await run(
		`toolsTest.main.getState().addTab({id:'other',panes:[{kind:'session',data:{}}]});toolsTest.launcherControl.finish()`,
	);
	await wait();
	assert.equal(await run("toolsTest.main.getState().activeTabId"), "other");
	assert.equal(
		await run(
			'Object.values(toolsTest.main.getState().getTab("main").panes).filter(p=>p.kind==="terminal").length',
		),
		1,
	);
	assert.equal(
		await run(
			'toolsTest.main.getState().getTab("other").panes[toolsTest.main.getState().getTab("other").activePaneId].kind',
		),
		"session",
	);
	pass(
		"Slow terminal launch stays in its original group; duplicate clicks are ignored and failures can retry",
	);
};
