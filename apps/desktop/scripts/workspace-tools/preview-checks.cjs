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
		};
		let m = await metrics();
		assert.equal(m.width, 1280);
		assert.equal(m.height, 800);
		assert.equal(m.overflow, false);
		assert.equal(await run("toolsTest.tools.state.getState().right.size"), 720);
		const bounds = () =>
			run(
				`(()=>{const w=document.querySelector('webview[style*="visible"]');const r=w.getBoundingClientRect();const p=document.querySelector('.gs-tool-slot-right [data-browser-placeholder]').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,fits:r.left>=p.left-1&&r.top>=p.top-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1,transform:w.style.transform}})()`,
			);
		assert.equal((await bounds()).fits, true);
		assert.equal((await bounds()).transform, "");
		await capture("preview-desktop");
		await clickGuest();
		pass(
			"Agent preview opens a whole 1280 x 800 desktop canvas fitted inside its sidebar",
		);
		const setMode = async (mode) => {
			await run(
				`(()=>{const s=document.querySelector('.gs-tool-slot-right select[aria-label="Preview device"]');s.value=${JSON.stringify(mode)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`,
			);
			await wait(500);
		};
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
		assert.equal(await run("toolsTest.tools.state.getState().right.size"), 720);
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
		await click('[aria-label="Move tab to right panel"]');
		await wait();
		await setMode("responsive");
		m = await metrics();
		assert.doesNotMatch(m.ua, /SM-S921B/);
		await clickGuest();
		assert.equal(await read("window.clicked"), clicks);
		await setMode("galaxy-s24");
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
	} finally {
		server.close();
	}
};
