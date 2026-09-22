const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const output = process.env.GS_TOOLS_TEST_OUTPUT;
if (!output) throw Error("Use test-workspace-tools.ts");
app.setPath("userData", path.join(output, `profile-${process.pid}`));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
let win;
const report = { checks: [], errors: [] };
const run = (js) => win.webContents.executeJavaScript(js);
const wait = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
const click = async (selector) => {
	const point = await run(
		`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing click target');const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
			type,
			...point,
			button: type === "mouseMoved" ? "none" : "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
		await wait(40);
	}
};
function pass(name) {
	report.checks.push(name);
	console.log(`PASS: ${name}`);
}
async function capture(name) {
	fs.writeFileSync(
		path.join(output, `${name}.png`),
		(await win.webContents.capturePage()).toPNG(),
	);
}
async function finish(error) {
	if (error) {
		report.errors.push(error.stack);
		console.error(error);
		if (win) await capture("failure").catch(() => {});
	}
	fs.writeFileSync(
		path.join(output, "results.json"),
		JSON.stringify({ ok: !error && !report.errors.length, ...report }, null, 2),
	);
	app.exit(error || report.errors.length ? 1 : 0);
}
const timeout = setTimeout(() => finish(Error("Timed out")), 90000);
app
	.whenReady()
	.then(async () => {
		win = new BrowserWindow({
			width: 1800,
			height: 1050,
			useContentSize: true,
			show: false,
			webPreferences: {
				backgroundThrottling: false,
				webviewTag: true,
				offscreen: true,
			},
		});
		win.webContents.on("console-message", (_event, level, message) => {
			if (level === 3) report.errors.push(message);
		});
		await win.loadFile(path.join(output, "index.html"));
		win.webContents.debugger.attach("1.3");
		await win.webContents.debugger.sendCommand(
			"Emulation.setFocusEmulationEnabled",
			{ enabled: true },
		);
		await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
		});
		await wait(700);
		await run(
			`for(const key of ['AudioVolumeUp','AudioVolumeDown','AudioVolumeMute','MediaPlayPause','Unidentified']) { document.dispatchEvent(new KeyboardEvent('keydown',{key,code:'',bubbles:true})); document.dispatchEvent(new KeyboardEvent('keyup',{key,code:'',bubbles:true})); }`,
		);
		assert.deepEqual(await run("toolsTest.hotkeyCalls"), []);
		assert.equal(await run("toolsTest.main.getState().tabs.length"), 1);
		pass(
			"Media keys and empty key codes cannot invoke unassigned shortcuts or create tabs",
		);
		await run("toolsTest.setShortcut('ctrl+shift+j')");
		await wait(100);
		await run(
			`document.dispatchEvent(new KeyboardEvent('keydown',{key:'J',code:'KeyJ',ctrlKey:true,shiftKey:true,bubbles:true})); document.dispatchEvent(new KeyboardEvent('keyup',{key:'J',code:'KeyJ',ctrlKey:true,shiftKey:true,bubbles:true}));`,
		);
		assert.deepEqual(await run("toolsTest.hotkeyCalls"), ["split-right"]);
		await run("toolsTest.setShortcut(null); toolsTest.hotkeyCalls.length=0");
		pass("Assigned shortcuts still work and can be unassigned again");
		assert.equal(
			await run(
				"document.querySelectorAll('[aria-label=\"Toggle right panel\"]').length",
			),
			1,
		);
		assert.equal(
			await run(
				"document.querySelectorAll('[aria-label=\"Toggle bottom panel\"]').length",
			),
			1,
		);
		pass("Two main panes have exactly one shared pair of panel buttons");
		assert.equal(
			await run(
				'document.querySelector(\'[aria-label="Toggle right panel"]\').closest("[data-pane-id]").dataset.paneId',
			),
			"session-b",
		);
		pass("Upper-right visible pane owns the controls");
		assert.equal(
			await run(
				"Math.round(document.querySelector('[aria-label=\"Open session folder in File Explorer\"]').parentElement.parentElement.getBoundingClientRect().height/.85)",
			),
			58,
		);
		pass("Real pane header uses the approved 58px height at 85% scale");
		await click('[aria-label="Open session folder in File Explorer"]');
		assert.equal((await run("window.folderOpened")).app, "finder");
		pass("Folder icon invokes File Explorer with the session directory");
		await run(
			'document.querySelector(\'[data-pane-id="session-a"] [aria-label="Pane menu"]\').dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,ctrlKey:false,pointerType:"mouse"}))',
		);
		await wait(100);
		assert.ok(await run('document.body.innerText.includes("Account: Yish")'));
		pass("Session menu shows the running account");
		await run(
			'document.querySelector(\'[data-pane-id="session-a"] [aria-label="Pane menu"]\').dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,ctrlKey:false,pointerType:"mouse"}))',
		);
		await wait(400);
		console.log(
			"Menu state",
			await run(
				"({menus:Array.from(document.querySelectorAll('[role=\"menu\"]')).map(e=>({state:e.dataset.state,animation:getComputedStyle(e).animationName})),pointer:getComputedStyle(document.body).pointerEvents,visibility:document.visibilityState})",
			),
		);
		assert.equal(
			await run(
				'document.querySelectorAll(\'[role="menu"][data-state="open"]\').length',
			),
			0,
		);
		await click('[aria-label="Toggle right panel"]');
		await wait(450);
		assert.equal(
			await run("toolsTest.tools.state.getState().right.open"),
			true,
			"Real pointer click opens right panel",
		);
		assert.equal(await run("toolsTest.tools.store.getState().tabs.length"), 0);
		assert.equal(await run('document.querySelectorAll("webview").length'), 0);
		assert.deepEqual(
			await run(
				"Array.from(document.querySelectorAll('[aria-label=\"Choose a right tool\"] button')).map(e=>e.textContent.trim())",
			),
			["Files", "Side session", "Browser", "Terminal", "Changes"],
		);
		await capture("right-tool-chooser");
		await click('[aria-label="Hide right panel"]');
		await wait();
		await click('[aria-label="Toggle right panel"]');
		await wait();
		assert.equal(await run("toolsTest.tools.store.getState().tabs.length"), 0);
		pass(
			"Empty right panel opens and reopens the tool chooser without creating a browser",
		);
		await click(".gs-tool-slot-right .gs-tool-choice:nth-child(3)");
		await wait();
		assert.equal(
			await run("toolsTest.tools.store.getState().getActivePane().pane.kind"),
			"browser",
		);
		assert.equal(
			await run(
				'document.querySelectorAll(".gs-tool-slot-right .gs-tool-chooser").length',
			),
			0,
		);
		pass("Choosing Browser opens a browser tab and replaces the chooser");
		await click('[aria-label="Toggle bottom panel"]');
		await wait(2000);
		const geometry = await run(
			'(()=>{const m=document.querySelector(".gs-tool-main").getBoundingClientRect(),r=document.querySelector(".gs-tool-slot-right").getBoundingClientRect(),b=document.querySelector(".gs-tool-slot-bottom").getBoundingClientRect();return {mainRight:m.right,rightLeft:r.left,bottomTop:b.top,mainBottom:m.bottom,width:innerWidth,bodyWidth:document.body.scrollWidth}})()',
		);
		assert.ok(Math.abs(geometry.mainRight - geometry.rightLeft) < 2);
		assert.ok(Math.abs(geometry.bottomTop - geometry.mainBottom) < 2);
		assert.equal(geometry.width, geometry.bodyWidth);
		pass(
			"Both shared panels fit beside and beneath the pane grid without overflow",
		);
		const ground = await run(`(()=>{
			const selectors=['.gs-tool-main','.gs-tool-slot-right','.gs-tool-slot-bottom'];
			return selectors.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:Math.ceil(r.x+2),y:Math.ceil(r.y+2)}});
		})()`);
		const shot = await win.webContents.capturePage();
		const pixels = shot.toBitmap();
		const colors = ground.map(({ x, y }) => {
			const offset = (y * shot.getSize().width + x) * 4;
			return Array.from(pixels.subarray(offset, offset + 4));
		});
		assert.deepEqual(
			colors[1],
			colors[0],
			"Right panel gutter must match the main pane well",
		);
		assert.deepEqual(
			colors[2],
			colors[0],
			"Bottom panel gutter must match the main pane well",
		);
		pass(
			"Rendered right and bottom gutters exactly match the main workspace background",
		);
		let term = await run("toolsTest.snapshotTerminal()");
		assert.deepEqual({ cols: term.cols, rows: term.rows }, term.proposed);
		if (term.buffer) assert.deepEqual(term.viewport, [0, 0, ...term.buffer]);
		else assert.equal(term.domRows, term.rows);
		pass("Real xterm fits the bottom panel with correctly sized renderer rows");
		assert.equal(
			await run(
				"document.querySelectorAll('.gs-tool-main [data-focused=\"true\"]').length",
			),
			0,
		);
		assert.equal(
			await run(
				"document.querySelectorAll('[data-terminal][data-focused=\"true\"]').length",
			),
			1,
		);
		pass("Only the focused tool receives active keyboard state");
		await run("toolsTest.paintTerminal()");
		await wait(120);
		await capture("both-panels");
		console.log(
			"Computed layout",
			await run(
				'(()=>{const e=document.querySelector("[data-pane-id]");const h=e.querySelector("[aria-label=\\"Pane menu\\"]").parentElement.parentElement;return {pane: {padding:getComputedStyle(e.parentElement).padding,inset:getComputedStyle(e).getPropertyValue("--gs-pane-inset")},header:{padding:getComputedStyle(h).padding,gap:getComputedStyle(h).gap,font:getComputedStyle(h).fontSize},pointer:getComputedStyle(document.body).pointerEvents}})()',
			),
		);
		const before = await run(
			"toolsTest.tools.store.getState().tabs.map(t=>t.id)",
		);
		await run('toolsTest.tools.open("right","browser")');
		await wait();
		const rightTabs = await run(
			'toolsTest.tools.store.getState().tabs.filter(t=>toolsTest.tools.state.getState().placement[t.id]==="right").map(t=>t.id)',
		);
		// Exercise the real dnd-kit pointer path against the hidden Electron window.
		const boxes = await run(
			"Array.from(document.querySelectorAll('.gs-tool-slot-right [role=\"tab\"]')).map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})",
		);
		const mouse = (type, x, y, buttons) =>
			win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
				type,
				x,
				y,
				button: "left",
				buttons,
				clickCount: 1,
			});
		await mouse("mouseMoved", boxes[1].x, boxes[1].y, 0);
		await mouse("mousePressed", boxes[1].x, boxes[1].y, 1);
		for (let i = 1; i <= 12; i++) {
			await mouse(
				"mouseMoved",
				boxes[1].x + ((boxes[0].x - boxes[1].x) * i) / 12,
				boxes[0].y,
				1,
			);
			await wait(20);
		}
		await mouse("mouseReleased", boxes[0].x, boxes[0].y, 0);
		await wait();
		console.log("Drag events", await run("toolsTest.dragEvents"));
		assert.deepEqual(
			await run(
				'toolsTest.tools.store.getState().tabs.filter(t=>toolsTest.tools.state.getState().placement[t.id]==="right").map(t=>t.id)',
			),
			rightTabs.toReversed(),
		);
		pass("Pointer drag reorders the real right-panel tabs");
		await run(
			"document.querySelector('.gs-tool-slot-right [role=\"tab\"]').focus()",
		);
		const key = async (key, code, virtual) => {
			await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
				type: "keyDown",
				key,
				code,
				windowsVirtualKeyCode: virtual,
			});
			await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
				type: "keyUp",
				key,
				code,
				windowsVirtualKeyCode: virtual,
			});
			await wait(150);
		};
		await key(" ", "Space", 32);
		await key("ArrowRight", "ArrowRight", 39);
		await key(" ", "Space", 32);
		await wait();
		assert.deepEqual(
			await run(
				'toolsTest.tools.store.getState().tabs.filter(t=>toolsTest.tools.state.getState().placement[t.id]==="right").map(t=>t.id)',
			),
			rightTabs,
		);
		pass("Keyboard dragging reorders the real tool tabs");
		await click('[aria-label="Move tab to bottom panel"]');
		await wait();
		assert.equal(
			await run(
				`toolsTest.tools.state.getState().placement[${JSON.stringify(rightTabs[1])}]`,
			),
			"bottom",
		);
		assert.deepEqual(await run("toolsTest.disposed"), []);
		pass("Moving a tab between panels preserves the browser/session lifecycle");
		await run(`toolsTest.tools.select(${JSON.stringify(before[1])})`);
		await wait();
		await click('[aria-label="Hide bottom panel"]');
		await wait(70);
		const during = await run(
			'document.querySelector(".gs-tool-slot-bottom").getBoundingClientRect().height',
		);
		console.log(
			"Closing animation",
			during,
			await run(
				'({transition:getComputedStyle(document.querySelector(".gs-tool-workspace")).transition, rows:getComputedStyle(document.querySelector(".gs-tool-workspace")).gridTemplateRows})',
			),
		);
		assert.ok(during > 0 && during < 300 * 0.85);
		await wait();
		assert.equal(
			await run(
				'Math.round(document.querySelector(".gs-tool-slot-bottom").getBoundingClientRect().height)',
			),
			0,
		);
		assert.deepEqual(await run("toolsTest.disposed"), []);
		pass("Closing animates to zero without disposing tool sessions");
		await click('[aria-label="Toggle bottom panel"]');
		await wait(600);
		term = await run("toolsTest.snapshotTerminal()");
		assert.deepEqual({ cols: term.cols, rows: term.rows }, term.proposed);
		if (term.buffer) assert.deepEqual(term.viewport, [0, 0, ...term.buffer]);
		else assert.equal(term.domRows, term.rows);
		pass("Reopening restores the terminal with correct renderer dimensions");
		const dirty = await run(
			'toolsTest.tools.add("right",{kind:"file",data:{filePath:"C:/test.txt",mode:"editor"}})',
		);
		await wait();
		await click('[aria-label="Close Unsaved file"]');
		await wait();
		assert.ok(
			await run(
				`!!toolsTest.tools.store.getState().getTab(${JSON.stringify(dirty)})`,
			),
		);
		pass("Closing a tool tab respects unsaved-file cancellation");
		await run(
			'toolsTest.tools.resize("right",650);toolsTest.tools.resize("bottom",360)',
		);
		await wait();
		term = await run("toolsTest.snapshotTerminal()");
		assert.deepEqual({ cols: term.cols, rows: term.rows }, term.proposed);
		pass("Panel resizing refits the running terminal");
		win.setContentSize(1000, 700);
		await wait(600);
		assert.ok(
			await run(
				'document.querySelector(".gs-tool-main").getBoundingClientRect().width>=330',
			),
		);
		assert.equal(await run("document.documentElement.scrollWidth"), 1000);
		assert.ok(
			await run(
				'(()=>{const main=document.querySelector(".gs-tool-main").getBoundingClientRect();return Array.from(document.querySelectorAll(".gs-tool-main [data-pane-id]")).every(e=>{const r=e.getBoundingClientRect();return r.left>=main.left&&r.right<=main.right+1&&r.top>=main.top&&r.bottom<=main.bottom+1})})()',
			),
		);
		pass("Smaller windows clamp panels and retain usable main panes");
		await capture("compact-panels");
		win.setContentSize(1800, 1050);
		await wait();
		await run(
			'toolsTest.tools.select(toolsTest.tools.store.getState().tabs.find(t=>Object.values(t.panes).some(p=>p.kind==="browser")).id)',
		);
		await wait();
		await run('toolsTest.tools.setOpen("right",false)');
		await wait(70);
		assert.ok(
			await run(
				'Array.from(document.querySelectorAll("webview")).filter(e=>e.style.visibility==="visible").every(e=>e.style.clipPath.startsWith("inset("))',
			),
		);
		await wait();
		pass("Native browser overlays stay clipped during panel transitions");
		assert.equal(
			await run(
				"document.querySelector('[aria-label=\"Draft session-a\"]').value",
			),
			"Unsent draft for session-a",
		);
		assert.equal(
			await run('document.querySelector("#floating-tabs").textContent'),
			"Claude　 Claude　 +",
		);
		pass("Main drafts and floating top tabs survive tool operations");
		await run('toolsTest.tools.open("right","browser")');
		await wait();
		const closingPane = await run(
			"toolsTest.tools.store.getState().getActivePane().pane.id",
		);
		await run(
			'document.querySelector(\'.gs-tool-slot-right [role="tab"][aria-selected="true"]\').parentElement.querySelector(\'button[aria-label^="Close "]\').click()',
		);
		await wait(60);
		assert.ok(await run('!!document.querySelector(".gs-tool-tab-exiting")'));
		assert.ok(
			await run(`toolsTest.disposed.includes(${JSON.stringify(closingPane)})`),
		);
		await wait(200);
		assert.equal(
			await run('document.querySelectorAll(".gs-tool-tab-exiting").length'),
			0,
		);
		pass(
			"Tab closing animates its chip while releasing the closed browser once",
		);
		await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "reduce" }],
		});
		assert.ok(
			await run(
				'getComputedStyle(document.querySelector(".gs-tool-workspace")).transitionDuration.split(",").every(value=>parseFloat(value)===0)',
			),
		);
		assert.ok(
			await run(
				'Array.from(document.querySelectorAll(".gs-tool-tab,.gs-tool-view")).every(e=>getComputedStyle(e).animationName==="none")',
			),
		);
		pass(
			"Reduced-motion preferences disable panel, tab and content animations",
		);
		await run(
			'for(const tab of [...toolsTest.tools.store.getState().tabs]) {if(toolsTest.tools.state.getState().placement[tab.id]==="right") toolsTest.tools.store.getState().removeTab(tab.id)}',
		);
		await wait();
		assert.ok(
			await run(
				"!!document.querySelector('.gs-tool-slot-right [aria-label=\"Choose a right tool\"]')",
			),
		);
		await click(".gs-tool-slot-right .gs-tool-choice:nth-child(2)");
		await wait();
		assert.equal(
			await run("toolsTest.tools.store.getState().getActivePane().pane.kind"),
			"session",
		);
		pass(
			"Closing the last right tab restores the chooser and Side session opens the requested tool",
		);
		clearTimeout(timeout);
		await finish();
	})
	.catch((error) => {
		clearTimeout(timeout);
		void finish(error);
	});
