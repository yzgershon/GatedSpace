const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const output = process.env.GS_TOOLS_TEST_OUTPUT;
app.setPath("userData", path.join(output, `preview-profile-${process.pid}`));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
const wait = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
let win;
const run = (script) => win.webContents.executeJavaScript(script);
async function click(selector, button = "left") {
	const point = await run(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
			type,
			...point,
			button: type === "mouseMoved" ? "none" : button,
			buttons: type === "mousePressed" ? (button === "right" ? 2 : 1) : 0,
			clickCount: 1,
		});
		await wait(40);
	}
	await wait();
}
async function capture(name) {
	fs.writeFileSync(
		path.join(output, `${name}.png`),
		(await win.webContents.capturePage()).toPNG(),
	);
}
const pass = (name) => {
	checks.push(name);
	console.log(`PASS: ${name}`);
};
const deadline = setTimeout(
	() => finish(Error("Preview verification timed out")),
	60000,
);
async function finish(error) {
	clearTimeout(deadline);
	if (error) {
		console.error(error);
		await capture("failure").catch(() => {});
	}
	fs.writeFileSync(
		path.join(output, "preview-results.json"),
		JSON.stringify({ ok: !error, checks, error: error?.stack }, null, 2),
	);
	app.exit(error ? 1 : 0);
}
app
	.whenReady()
	.then(async () => {
		win = new BrowserWindow({
			width: 1500,
			height: 900,
			show: false,
			useContentSize: true,
			webPreferences: {
				offscreen: true,
				backgroundThrottling: false,
				webviewTag: true,
			},
		});
		await win.loadFile(path.join(output, "index.html"), {
			query: { preview: "1" },
		});
		win.webContents.debugger.attach("1.3");
		await win.webContents.debugger.sendCommand(
			"Emulation.setFocusEmulationEnabled",
			{ enabled: true },
		);
		await wait(2800);
		await capture("headers");
		assert.equal(
			await run(
				`document.querySelectorAll('[data-pane-id="session-b"] img[title="Codex session"]').length`,
			),
			1,
		);
		pass(
			"terminal custom title preserves the agent icon beside its folder button",
		);
		const metrics = await run(
			`(()=>{const roots=['session-a','session-b'].map(id=>document.querySelector('[data-pane-id="'+id+'"]'));return roots.map(root=>{const menu=root.querySelector('[aria-label="Pane menu"]').getBoundingClientRect(),add=root.querySelector('[aria-label="New pane"]').getBoundingClientRect(),header=root.firstElementChild.getBoundingClientRect();return{height:header.height,menuLeft:menu.left,addRight:add.right}})})()`,
		);
		assert.equal(metrics[0].height, metrics[1].height);
		for (const m of metrics)
			assert.ok(m.menuLeft >= m.addRight && m.menuLeft - m.addRight < 12);
		assert.ok(
			await run(
				`(()=>{const button=document.querySelector('[aria-label="Terminal sessions"]'),text=button.querySelector('span');return button.getBoundingClientRect().right-text.getBoundingClientRect().right<25})()`,
			),
		);
		assert.equal(
			await run(
				`document.querySelectorAll('[data-pane-id] svg.lucide-pencil-line').length`,
			),
			0,
		);
		pass(
			"Both header types share sizing, compact titles and title-plus-menu order",
		);
		await click('[data-pane-id="session-b"] [aria-label="Pane menu"]');
		await capture("terminal-menu");
		const menu = await run(`document.querySelector('[role="menu"]').innerText`);
		for (const unwanted of [
			"Scroll to Bottom",
			"New Pane",
			"Split Horizontally",
			"Split with New Session",
			"Split with New Browser",
			"Equalize Pane Splits",
			"Open in",
			"Move to Tab",
			"Close Other Panes",
			"Kill Terminal Session",
		])
			assert.ok(!menu.includes(unwanted), unwanted);
		await run(
			`document.querySelectorAll('[role="menuitem"]').forEach(e=>{if(e.textContent.includes('Rename Pane'))e.setAttribute('data-test-rename','true')})`,
		);
		await click("[data-test-rename]");
		assert.ok(
			await run(
				`document.querySelector('[data-pane-id="session-b"] input[aria-label="Rename pane"]')!==null`,
			),
		);
		await win.webContents.debugger.sendCommand("Input.insertText", {
			text: "Terminal renamed",
		});
		await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await wait();
		assert.equal(
			await run(
				`toolsTest.main.getState().getPane('session-b').pane.titleOverride`,
			),
			"Terminal renamed",
		);
		pass(
			"Terminal rename works from the reduced menu with real keyboard input",
		);
		await click('[data-pane-id="session-a"] > div:first-child', "right");
		await run(
			`document.querySelectorAll('[role="menuitem"]').forEach(e=>{if(e.textContent.includes('Rename Pane'))e.setAttribute('data-test-rename','true')})`,
		);
		await click("[data-test-rename]");
		assert.ok(
			await run(
				`document.querySelector('[data-pane-id="session-a"] input[aria-label="Rename pane"]')===document.activeElement`,
			),
		);
		await win.webContents.debugger.sendCommand("Input.insertText", {
			text: "Discard this name",
		});
		for (const type of ["keyDown", "keyUp"])
			await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
				type,
				key: "Escape",
				code: "Escape",
				windowsVirtualKeyCode: 27,
			});
		await wait();
		assert.equal(
			await run(
				`toolsTest.main.getState().getPane('session-a').pane.titleOverride`,
			),
			"GatedSpace Edits",
		);
		pass(
			"Right-click rename focuses the session title and Escape cancels cleanly",
		);
		win.setContentSize(920, 720);
		await wait();
		assert.ok(
			await run(
				`(()=>{return [...document.querySelectorAll('.gs-tool-main [data-pane-id]')].every(root=>{const h=root.firstElementChild.getBoundingClientRect();return [...root.firstElementChild.querySelectorAll('button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=h.left && r.right<=h.right && r.top>=h.top && r.bottom<=h.bottom})})})()`,
			),
		);
		await capture("compact-headers");
		win.setContentSize(1500, 900);
		await wait();
		pass("Both headers keep their controls inside narrow panes");
		await click('[data-pane-id="session-b"] [aria-label="Expand pane"]');
		assert.equal(
			await run(
				`document.querySelectorAll('.gs-tool-main [data-pane-id]').length`,
			),
			1,
		);
		await click('[aria-label="Restore pane"]');
		pass("Expand and restore preserve the shared panel controls");
		await click('[data-pane-id="session-a"] [aria-label="New pane"]');
		assert.equal(
			await run(`Object.keys(toolsTest.main.getState().tabs[0].panes).length`),
			3,
		);
		await click(
			'.gs-tool-main [data-pane-id]:not([data-pane-id="session-a"]):not([data-pane-id="session-b"]) [aria-label="Close pane"]',
		);
		assert.equal(
			await run(`Object.keys(toolsTest.main.getState().tabs[0].panes).length`),
			2,
		);
		await click('[data-pane-id="session-a"] [aria-label="Close pane"]');
		assert.equal(
			await run(`Object.keys(toolsTest.main.getState().tabs[0].panes).length`),
			1,
		);
		pass(
			"Quick add and close buttons work when clicking inactive and newly added panes",
		);
		await click('[aria-label="Toggle right panel"]');
		await click('[aria-label="Toggle bottom panel"]');
		assert.equal(
			await run("toolsTest.tools.state.getState().right.open"),
			true,
		);
		assert.equal(
			await run("toolsTest.tools.state.getState().bottom.open"),
			true,
		);
		pass(
			"Both dock toggles respond to real mouse clicks from the terminal header",
		);
		await finish();
	})
	.catch(finish);
