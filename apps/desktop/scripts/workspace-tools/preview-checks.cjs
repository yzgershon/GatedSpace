const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async ({
	win,
	run,
	wait,
	click,
	capture,
	pass,
	guests,
	webContents,
	browserAdapter,
	output,
}) => {
	const server = http.createServer((_req, res) => {
		res.setHeader("Content-Type", "text/html");
		res.end(fs.readFileSync(path.join(output, "page.html")));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const url = `http://127.0.0.1:${server.address().port}/`;
		const savedRightSize = await run(
			"toolsTest.tools.state.getState().right.size",
		);
		await run(
			`toolsTest.openAgentBrowserTab(toolsTest.tools,{paneId:'preview-check',url:${JSON.stringify(url)}})`,
		);
		await wait(1600);
		const guest = webContents.fromId(guests.get("preview-check"));
		assert.ok(guest);
		const read = (js) => guest.executeJavaScript(js);
		const metrics = () =>
			read(
				"({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth,ua:navigator.userAgent})",
			);
		let clicks = 0;
		const clickGuest = async () => {
			await run(`(() => {
				const composer = document.querySelector('[aria-label="Draft session-a"]');
				composer.focus(); composer.setSelectionRange(3,3);
				toolsTest.tools.focus('main');
			})()`);
			const snapshot = await browserAdapter.run(
				"browser_snapshot",
				"preview-check",
				{},
			);
			const button = JSON.parse(snapshot.content[0].text).elements.find(
				(e) => e.tag === "button",
			);
			assert.ok(button);
			const result = await browserAdapter.run(
				"browser_click",
				"preview-check",
				{ ref: button.ref },
			);
			assert.match(result.content[0].text, /Click received/);
			assert.equal(await read("window.clicked"), ++clicks);
			assert.equal(
				await run('document.activeElement.getAttribute("aria-label")'),
				"Draft session-a",
			);
			assert.deepEqual(
				await run(
					"[document.activeElement.selectionStart,document.activeElement.selectionEnd]",
				),
				[3, 3],
			);
			assert.equal(await run("toolsTest.tools.state.getState().focus"), "main");
			await win.webContents.debugger.sendCommand("Input.insertText", {
				text: "!",
			});
			assert.equal(
				await run("document.activeElement.value"),
				"Uns!ent draft for session-a",
			);
			await run('document.activeElement.value="Unsent draft for session-a"');
		};
		let m = await metrics();
		assert.equal(
			await run(
				`document.querySelector('.gs-tool-slot-right [aria-label="Preview size"]').dataset.mode`,
			),
			"responsive",
		);
		assert.equal(m.overflow, false);
		assert.equal(
			await run("toolsTest.tools.state.getState().right.size"),
			savedRightSize,
		);
		const bounds = () =>
			run(
				`(()=>{const w=document.querySelector('webview[style*="visible"]');const r=w.getBoundingClientRect();const p=document.querySelector('.gs-tool-slot-right [data-browser-placeholder]').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,fits:r.left>=p.left-1&&r.top>=p.top-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1,transform:w.style.transform}})()`,
			);
		assert.equal((await bounds()).fits, true);
		assert.equal((await bounds()).transform, "");
		await capture("preview-responsive");
		await clickGuest();
		pass(
			"Agent preview defaults to responsive and preserves the chosen sidebar width",
		);
		const openPreviewMenu = async () => {
			await click('.gs-tool-slot-right [aria-label="Preview size"]');
			await wait(150);
			assert.equal(
				await run(
					`document.querySelectorAll('.gs-browser-preview-menu [role="menuitemradio"]').length`,
				),
				3,
			);
			assert.equal(
				await run(
					`(()=>{const el=document.querySelector('.gs-browser-preview-menu [aria-label="Galaxy S24"]');const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
				),
				true,
			);
		};
		const setMode = async (mode) => {
			const labels = {
				responsive: "Responsive",
				desktop: "Desktop",
				"galaxy-s24": "Galaxy S24",
			};
			await openPreviewMenu();
			await click(
				`.gs-browser-preview-menu [role="menuitemradio"][aria-label="${labels[mode]}"]`,
			);
			await wait(500);
			assert.equal(
				await run(
					`document.querySelector('.gs-tool-slot-right [aria-label="Preview size"]').dataset.mode`,
				),
				mode,
			);
		};
		assert.equal(
			await run(
				`(()=>{const button=document.querySelector('.gs-tool-slot-right [aria-label="Preview size"]').getBoundingClientRect();const content=document.querySelector('.gs-tool-slot-right [data-browser-placeholder]').getBoundingClientRect();return button.bottom<=content.top})()`,
			),
			true,
		);
		assert.equal(
			await run(
				`document.querySelectorAll('.gs-tool-slot-right select[aria-label="Preview device"]').length`,
			),
			0,
		);
		assert.equal(
			await run(
				`document.querySelectorAll('.gs-tool-slot-right button[aria-label="Close pane"], .gs-tool-slot-right button[aria-label="Close tool pane"]').length`,
			),
			0,
		);
		await openPreviewMenu();
		await capture("preview-size-menu");
		await run(
			"document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
		);
		await wait(200);
		pass(
			"Viewport controls live in the browser toolbar; readable radio menu is clickable above the webview",
		);

		await setMode("desktop");
		m = await metrics();
		assert.equal(m.width, 1280);
		assert.equal(m.height, 800);
		assert.equal((await bounds()).fits, true);
		await clickGuest();
		pass(
			"Desktop emulation stays available explicitly, with correctly scaled clicks",
		);
		await setMode("galaxy-s24");
		m = await metrics();
		assert.equal(m.width, 360);
		assert.equal(m.height, 780);
		assert.equal(m.dpr, 3);
		assert.match(m.ua, /SM-S921B/);
		assert.equal(m.overflow, false);
		assert.equal((await bounds()).fits, true);
		await capture("preview-galaxy-s24");
		// Hidden offscreen windows do not route host CDP events into guest targets.
		// Exercise Chromium's guest input at the displayed (scaled) coordinates.
		const target = await read(
			'(()=>{const r=document.querySelector("#check").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
		);
		const b = await bounds();
		assert.equal(
			await run(
				`document.elementFromPoint(${b.left + (target.x * b.width) / 360},${b.top + (target.y * b.height) / 780})?.tagName`,
			),
			"WEBVIEW",
		);
		await clickGuest();
		pass(
			"Galaxy S24 has a 360 x 780 CSS viewport at 3x density, and scaled click targets work",
		);
		await openPreviewMenu();
		await click('[aria-label="Rotate Galaxy S24"]');
		await wait();
		m = await metrics();
		assert.equal(m.width, 780);
		assert.equal(m.height, 360);
		assert.equal((await bounds()).fits, true);
		await clickGuest();
		pass(
			"Galaxy S24 landscape rotates the viewport without reloading the page",
		);
		await click('[aria-label="Expand right panel"]');
		await wait(500);
		assert.equal(
			await run(
				'document.querySelector(".gs-tool-workspace").dataset.expanded',
			),
			"right",
		);
		assert.ok((await bounds()).width > 600);
		assert.equal(await read("window.clicked"), clicks);
		assert.ok(await run('document.querySelector(".gs-tool-main").inert'));
		await capture("preview-expanded");
		await click('[aria-label="right panel options"]');
		await wait();
		await click('[aria-label="Move tab to bottom panel"]');
		await wait(500);
		assert.equal(
			await run(
				'document.querySelector(".gs-tool-workspace").dataset.expanded',
			),
			"bottom",
		);
		assert.equal(webContents.fromId(guests.get("preview-check")).id, guest.id);
		await click('[aria-label="Restore bottom panel"]');
		await wait(500);
		assert.equal(
			await run(
				'document.querySelector(".gs-tool-workspace").dataset.expanded',
			),
			undefined,
		);
		assert.equal(
			await run("toolsTest.tools.state.getState().right.size"),
			savedRightSize,
		);
		assert.equal(await read("window.clicked"), clicks);
		await click('.gs-tool-slot-bottom [aria-label="Expand pane"]');
		await wait(500);
		assert.equal(
			await run(
				'document.querySelector(".gs-tool-workspace").dataset.expanded',
			),
			"bottom",
		);
		await click('.gs-tool-slot-bottom [aria-label="Restore pane"]');
		await wait();
		pass(
			"Both panel and pane expand buttons fill the workspace; moving and restoring retain sizes and page state",
		);
		await click('[aria-label="bottom panel options"]');
		await wait();
		await click('[aria-label="Move tab to right panel"]');
		await wait();
		await setMode("responsive");
		m = await metrics();
		assert.doesNotMatch(m.ua, /SM-S921B/);
		await clickGuest();
		assert.equal(await read("window.clicked"), clicks);
		await setMode("galaxy-s24");
		await openPreviewMenu();
		await click('[aria-label="Rotate Galaxy S24"]');
		await wait();
		win.setContentSize(1000, 700);
		win.webContents.setZoomFactor(1.25);
		await wait(700);
		m = await metrics();
		assert.equal(m.width, 360);
		assert.equal(m.height, 780);
		assert.equal((await bounds()).fits, true);
		await capture("preview-compact-zoom");
		await clickGuest();
		pass(
			"Agent click coordinates stay aligned in desktop, phone, rotated, responsive and zoomed previews",
		);
		pass(
			"Responsive restores the regular browser; S24 remains fitted at compact window size and 125% app zoom",
		);
		win.webContents.setZoomFactor(1);
		win.setContentSize(1800, 1050);
		await wait();
		await run('toolsTest.tools.setOpen("right",false)');
		await wait(500);
		assert.equal(
			await run(
				'Array.from(document.querySelectorAll("webview")).filter(w=>w.style.visibility==="visible").length',
			),
			0,
		);
		await run('toolsTest.tools.setOpen("right",true)');
		await wait(500);
		assert.equal((await metrics()).width, 360);
		assert.equal(await read("window.clicked"), clicks);
		assert.equal(
			await run(
				"document.querySelector('[aria-label=\"Draft session-a\"]').value",
			),
			"Unsent draft for session-a",
		);
		pass(
			"Hidden native previews cannot cover other panes; reopen preserves preview mode and unsent drafts",
		);
		await read(`(() => {
			const input = document.createElement('input'); input.setAttribute('aria-label','Agent entry');
			input.style.cssText='position:fixed;left:30px;top:40px;width:180px;height:32px;z-index:20';
			document.body.appendChild(input);
		})()`);
		await run(
			"document.querySelector('[aria-label=\"Draft session-a\"]').focus()",
		);
		const page = JSON.parse(
			(await browserAdapter.run("browser_snapshot", "preview-check", {}))
				.content[0].text,
		);
		const field = page.elements.find((e) => e.tag === "input");
		assert.ok(field);
		await browserAdapter.run("browser_fill", "preview-check", {
			ref: field.ref,
			text: "Agent text",
			session: "claude:test",
		});
		await browserAdapter.run("browser_press", "preview-check", {
			key: "!",
			session: "claude:test",
		});
		assert.equal(
			await read('document.querySelector("input").value'),
			"Agent text!",
		);
		assert.equal(
			await run(
				"document.querySelector('[aria-label=\"Draft session-a\"]').value",
			),
			"Unsent draft for session-a",
		);
		await browserAdapter.run("browser_press", "preview-check", {
			key: "ArrowLeft",
		});
		await browserAdapter.run("browser_press", "preview-check", {
			key: "Backspace",
		});
		assert.equal(
			await read('document.querySelector("input").value'),
			"Agent tex!",
		);
		await browserAdapter.run("browser_press", "preview-check", { key: "t" });
		await browserAdapter.run("browser_press", "preview-check", { key: "End" });
		assert.equal(
			await read('document.querySelector("input").value'),
			"Agent text!",
		);
		await read(
			`document.querySelector('input').addEventListener('keydown',e=>{if(e.key==='Enter')window.agentEntered=true})`,
		);
		await browserAdapter.run("browser_press", "preview-check", {
			key: "Enter",
		});
		assert.equal(await read("window.agentEntered"), true);
		await browserAdapter.run("browser_press", "preview-check", { key: "Tab" });
		// This input is the final tab stop: cycle within the page instead of
		// advancing the user's host focus or typing into the draft.
		assert.equal(await read("document.activeElement.tagName"), "BUTTON");
		await browserAdapter.run("browser_press", "preview-check", { key: "x" });
		assert.equal(
			await run('document.activeElement.getAttribute("aria-label")'),
			"Draft session-a",
		);
		assert.equal(
			await run(
				"document.querySelector('[aria-label=\"Draft session-a\"]').value",
			),
			"Unsent draft for session-a",
		);
		const freshPage = JSON.parse(
			(await browserAdapter.run("browser_snapshot", "preview-check", {}))
				.content[0].text,
		);
		await browserAdapter.run("browser_fill", "preview-check", {
			ref: freshPage.elements.find((e) => e.tag === "input").ref,
			text: "Agent text!",
			session: "claude:test",
		});
		assert.equal(
			await run('document.activeElement.getAttribute("aria-label")'),
			"Draft session-a",
		);
		assert.equal(
			await read(
				'getComputedStyle(document.querySelector("[data-gatedspace-agent-cursor]")).pointerEvents',
			),
			"none",
		);
		assert.equal(
			await read(
				'document.querySelector("[data-gatedspace-agent-cursor]").getAttribute("aria-hidden")',
			),
			"true",
		);
		await capture("agent-cursor");
		pass(
			"Agent clicks, typing and fills preserve composer focus, selection, user typing and shortcut routing across preview modes",
		);
		pass(
			"The separate agent cursor is page-local, ignores pointer events and stays out of accessibility navigation",
		);
		await run('toolsTest.tools.setOpen("right",false)');
		await wait();
		const before = await run("toolsTest.tools.state.getState()");
		await run(
			`toolsTest.browserRuntimeRegistry.prepareForAgent('preview-check',{url:${JSON.stringify(url)}},()=>{})`,
		);
		await browserAdapter.run("browser_press", "preview-check", { key: "?" });
		assert.equal(
			await read('document.querySelector("input").value'),
			"Agent text!?",
		);
		assert.deepEqual(await run("toolsTest.tools.state.getState()"), before);
		assert.equal(
			await run('document.activeElement.getAttribute("aria-label")'),
			"Draft session-a",
		);
		pass(
			"A parked browser accepts agent input without reopening the sidebar or taking the user focus",
		);
		await run(
			`toolsTest.browserRuntimeRegistry.prepareForAgent('cold-agent',{url:${JSON.stringify(url)}},()=>{})`,
		);
		await wait(700);
		await browserAdapter.ready("cold-agent");
		const cold = await browserAdapter.run("browser_snapshot", "cold-agent", {});
		assert.match(cold.content[0].text, /Room to see the whole picture/);
		assert.deepEqual(await run("toolsTest.tools.state.getState()"), before);
		const coldButton = JSON.parse(cold.content[0].text).elements.find(
			(e) => e.tag === "button",
		);
		const warmPage = await browserAdapter.run(
			"browser_snapshot",
			"preview-check",
			{},
		);
		const warmButton = JSON.parse(warmPage.content[0].text).elements.find(
			(e) => e.tag === "button",
		);
		await Promise.all([
			browserAdapter.run("browser_click", "cold-agent", {
				ref: coldButton.ref,
			}),
			browserAdapter.run("browser_click", "preview-check", {
				ref: warmButton.ref,
			}),
		]);
		assert.equal(
			await run('document.activeElement.getAttribute("aria-label")'),
			"Draft session-a",
		);
		assert.equal(
			await run(
				"document.querySelector('[aria-label=\"Draft session-a\"]').value",
			),
			"Unsent draft for session-a",
		);
		assert.equal(
			await win.webContents.executeJavaScriptInIsolatedWorld(1006, [
				{ code: "globalThis.__gsBrowserFocusGuard === undefined" },
			]),
			true,
		);
		pass(
			"Overlapping browser actions preserve the user draft and release all host focus guards",
		);
		await run("toolsTest.browserRuntimeRegistry.destroy('cold-agent')");
		assert.equal(win.isVisible(), false);
		assert.equal(win.isFocused(), false);
		pass(
			"Restored background tabs initialize without stealing selection, and the test never activates a desktop window",
		);
	} finally {
		server.close();
	}
};
