import { describe, expect, it } from "bun:test";
import { MOBILE_BRIDGE_HTML } from "./client-html";

/**
 * The page is an inlined string with no build step, so nothing type-checks it,
 * bundles it or even parses it before a phone does. These tests are the only
 * thing standing between a stray character and a blank screen on a device
 * that is, by definition, not next to a debugger.
 */

function scriptBody(): string {
	const match = MOBILE_BRIDGE_HTML.match(/<script>([\s\S]*?)<\/script>/);
	return match?.[1] ?? "";
}

describe("the phone page", () => {
	it("has a script to check", () => {
		// Guards every other test here from passing on an empty string.
		expect(scriptBody().length).toBeGreaterThan(500);
	});

	it("parses as JavaScript", () => {
		// `new Function` compiles without running, which is exactly the check
		// wanted: syntax only, no side effects, no DOM needed.
		expect(() => new Function(scriptBody())).not.toThrow();
	});

	it("leaves no unresolved template interpolation", () => {
		// The HTML lives in a TS template literal. A stray `${...}` would have
		// been substituted at module load and silently changed the page.
		expect(MOBILE_BRIDGE_HTML).not.toContain("${");
	});

	it("emits the regex escapes it meant to", () => {
		// `\\s` in the TS source has to reach the browser as `\s`. Getting this
		// wrong yields a regex that matches a literal "s".
		expect(scriptBody()).toContain("replace(/\\s+$/");
		expect(scriptBody()).not.toContain("replace(/\\\\s+$/");
	});
});

describe("voice input", () => {
	const script = scriptBody();

	it("uses the phone's own recogniser, never the desktop", () => {
		// The whole point of the revised 4.3: audio does not leave the phone and
		// the desktop has no capture path at all.
		expect(script).toContain("window.webkitSpeechRecognition");
		expect(script).not.toContain("/api/voice");
	});

	it("checks the secure context before offering the button", () => {
		// SpeechRecognition throws on plain HTTP, which is the DEFAULT link mode.
		// Without this the button would be visible and broken for most users.
		expect(script).toContain("window.isSecureContext");
	});

	it("keeps the button hidden until both checks pass", () => {
		expect(MOBILE_BRIDGE_HTML).toContain('id="mic" aria-label="Dictate"');
		expect(MOBILE_BRIDGE_HTML).toMatch(/id="mic"[^>]*hidden/);
	});

	it("appends to the composer instead of replacing it", () => {
		expect(script).toContain("input.value = baseText + dictated");
	});

	it("rebuilds the transcript from index 0 rather than accumulating", () => {
		// event.results is cumulative and event.resultIndex is only a hint —
		// browsers commonly report it as 0 every event, so appending re-adds
		// finished words once per event.
		expect(script).toContain("for (var i = 0; i < event.results.length; i++)");
		expect(script).not.toContain("i = event.resultIndex");
	});

	it("builds a NEW recognizer for each restart", () => {
		// THE bug that survived three fixes. Restarting the same instance does
		// not clear its results list on Android, so the first event of the new
		// session re-delivered every word of the old one — on top of the text
		// already banked from it.
		expect(script).toContain("function newRecognizer()");
		expect(script).toContain("recog = newRecognizer()");
		// The old shape: restarting the instance that just ended.
		expect(script).not.toContain(
			"try { recog.start(); } catch (e) { stopMic(); }",
		);
	});

	it("banks a finished instance's text before the next one starts", () => {
		expect(script).toContain(
			"committed = mergeSpeech(committed, instanceFinal)",
		);
	});

	it("merges rather than concatenates", () => {
		// THE bug, finally understood: Android hands back the whole transcript on
		// every restart, so appending it to what was banked compounded every
		// prefix — "hellohello thishello this is".
		expect(script).toContain("function mergeSpeech(");
		expect(script).toContain("paint(mergeSpeech(committed,");
		expect(script).not.toContain("committed += instanceFinal");
	});

	it("ignores events from a recognizer it has moved on from", () => {
		// A discarded instance can still deliver one last event, which would
		// paint stale text over the live transcript.
		expect(script).toContain("if (instance !== recog) return");
	});

	it("restarts itself so a pause does not end dictation", () => {
		expect(script).toContain("instance.onend");
		expect(script).toContain("restartTimer = setTimeout");
	});

	it("waits a beat before restarting", () => {
		// Chrome ends immediately when it hears nothing; an instant restart is a
		// tight loop that holds the microphone open.
		expect(script).toMatch(/restartTimer = setTimeout\([\s\S]*?\}, \d+\)/);
	});

	it("refuses a second start while one is already running", () => {
		// Two recognizers both writing to the box is its own duplication bug.
		const startMic = script.slice(script.indexOf("function startMic()"));
		expect(startMic.slice(0, 300)).toContain("if (listening) return");
	});

	it("clears the listening flag before stopping, so onend cannot restart it", () => {
		// Ordering bug bait: stop() fires onend, and onend restarts while
		// listening is still true. The mic would be impossible to turn off.
		const stopMic = script.slice(script.indexOf("function stopMic()"));
		expect(stopMic.indexOf("listening = false")).toBeLessThan(
			stopMic.indexOf("instance.stop()"),
		);
	});

	it("keeps what was said when the mic is switched off mid-sentence", () => {
		const stopMic = script.slice(script.indexOf("function stopMic()"));
		expect(stopMic.slice(0, 700)).toContain(
			"committed = mergeSpeech(committed, instanceFinal)",
		);
	});

	it("never sends on its own", () => {
		// This drives an agent that runs shell commands. A misheard word should
		// cost a glance at the composer, not a turn.
		const send = script.slice(
			script.indexOf("function send()"),
			script.indexOf("sendBtn.onclick"),
		);
		expect(send).toContain("stopMic()");
	});
});

describe("hiding things actually hides them", () => {
	it("overrides the display rules that outrank the hidden attribute", () => {
		// footer, nav and .iconbtn all set an explicit display, which beats the
		// UA stylesheet's [hidden] rule. Without this the composer sits over the
		// tab bar on every screen and Back is permanently visible.
		expect(MOBILE_BRIDGE_HTML).toContain(
			"[hidden] { display: none !important; }",
		);
	});

	it("still sets an explicit display on the chrome, which is why it is needed", () => {
		// Guards the rule above from being deleted as redundant later.
		expect(MOBILE_BRIDGE_HTML).toMatch(/footer \{[^}]*display: flex/);
		expect(MOBILE_BRIDGE_HTML).toMatch(/nav \{[^}]*display: flex/);
	});
});

describe("staying paired", () => {
	const script = scriptBody();

	it("keeps the token across app restarts", () => {
		// sessionStorage dies when an installed PWA is closed, which is constantly
		// — every reopen landed on "this link has expired".
		expect(script).toContain('localStorage.setItem("bridge-token"');
		expect(script).toContain('localStorage.getItem("bridge-token")');
	});

	it("carries over a token saved by the old build", () => {
		expect(script).toContain('sessionStorage.getItem("bridge-token")');
	});

	it("drops a token the desktop has rotated", () => {
		// Otherwise the dead token wins over a freshly scanned link forever.
		expect(script).toContain('localStorage.removeItem("bridge-token")');
	});
});

describe("reading a long conversation", () => {
	const script = scriptBody();

	it("does not trim what the server already sent", () => {
		// A second cap on this side hid history that had been fetched, which is
		// what made a long session appear to begin partway through.
		expect(script).not.toContain("turns.slice(-40)");
	});

	it("asks for more when there is more", () => {
		expect(script).toContain("data.truncated");
		expect(script).toContain("Show earlier messages");
	});

	it("raises the limit rather than refetching the same window", () => {
		expect(script).toContain("eventLimit = Math.min(eventLimit * 4, 4000)");
	});

	it("goes back to the cheap default for each session opened", () => {
		// Otherwise one deep scroll-back makes every later session pull its
		// whole history over cellular.
		const open = script.slice(script.indexOf("function openSession("));
		expect(open.slice(0, 800)).toContain("eventLimit = 200");
	});
});

describe("the context meter", () => {
	const script = scriptBody();

	it("is there, so compacting is a decision rather than a surprise", () => {
		expect(script).toContain("function contextBar(");
		expect(script).toContain('label.textContent = "Context"');
	});

	it("uses the desktop's own escalation points", () => {
		expect(script).toContain('pct >= 90 ? " hot" : pct >= 70 ? " warn"');
	});

	it("shows nothing rather than a zero when the figure is unknown", () => {
		// Context is only known once a turn has completed.
		expect(script).toContain(
			"if (!context || !context.contextTokens) return null",
		);
	});

	it("still reports tokens when the window size is unknown", () => {
		expect(script).toContain("pct === null");
	});
});

describe("attachments", () => {
	const script = scriptBody();

	it("has a + and a picker in the composer", () => {
		expect(MOBILE_BRIDGE_HTML).toContain('id="attach"');
		expect(MOBILE_BRIDGE_HTML).toContain('accept="image/*"');
		expect(MOBILE_BRIDGE_HTML).toContain("multiple");
	});

	it("downscales before uploading", () => {
		// A phone photo is several MB, which is slow over cellular and over the
		// size the session accepts anyway.
		expect(script).toContain("MAX_IMAGE_EDGE");
		expect(script).toContain('canvas.toDataURL("image/jpeg", 0.85)');
	});

	it("strips the data: prefix, sending base64 only", () => {
		// The server rejects anything that is not base64, and a data URL would
		// decode to nothing on the model's side.
		expect(script).toContain('.split(",")[1]');
	});

	it("sends a much smaller thumbnail alongside", () => {
		// It rides inside the event, which lives for the whole session.
		expect(script).toContain('thumb.toDataURL("image/jpeg", 0.6)');
	});

	it("lets an image be a message on its own", () => {
		expect(script).toContain(
			"if ((!text && !pending.length) || !current) return",
		);
	});

	it("keeps the images staged when the send fails", () => {
		// Otherwise a failed send means re-picking every screenshot.
		const send = script.slice(script.indexOf("function send()"));
		const clearIndex = send.indexOf("pending = []");
		const catchIndex = send.indexOf(".catch(");
		expect(clearIndex).toBeGreaterThan(-1);
		expect(clearIndex).toBeLessThan(catchIndex);
	});

	it("resets the file input so the same photo can be picked twice", () => {
		// Without this, choosing the same file again fires no change event.
		expect(script).toContain('fileInput.value = ""');
	});

	it("caps how many go in one message", () => {
		expect(script).toContain("MAX_ATTACHMENTS");
	});

	it("clears the shelf when leaving a conversation", () => {
		// It is fixed to the viewport rather than inside the composer, so it
		// would otherwise float over the sessions list.
		const setTab = script.slice(script.indexOf("function setTab("));
		expect(setTab.slice(0, 600)).toContain("pending = []");
	});
});

describe("the thinking mark", () => {
	const script = scriptBody();

	it("is driven by the turn, not by the process being alive", () => {
		// `running` is true for the whole time a session pane is open, because the
		// CLI process persists between turns. Driving the mark from it meant it
		// pulsed forever and told you nothing.
		expect(script).toContain("if (data.thinking)");
		expect(script).not.toContain(
			"if (data.running) main.appendChild(thinkingRow())",
		);
	});

	it("stops its animation when the turn ends", () => {
		// The element is replaced on each poll, but the interval it started is
		// not — it has to be cleared or it keeps firing for the life of the page.
		const refresh = script.slice(script.indexOf("function refresh()"));
		expect(refresh).toContain(
			"else { clearInterval(thinkTimer); thinkTimer = null; }",
		);
	});

	it("also stops when the pane is detached mid-animation", () => {
		expect(script).toContain("if (!mark.isConnected)");
	});

	it("uses the desktop's own frames", () => {
		expect(script).toContain("SPINNER_FRAMES");
	});
});

describe("the tabbed shell", () => {
	const script = scriptBody();

	it("has all three tabs in the markup", () => {
		for (const tab of ["sessions", "usage", "settings"]) {
			expect(MOBILE_BRIDGE_HTML).toContain(`data-tab="${tab}"`);
		}
	});

	it("hides the tab bar inside a conversation", () => {
		// The composer takes the bottom of the screen there; both at once would
		// stack two fixed bars over the text being read.
		expect(script).toContain("tabs.hidden = true");
	});

	it("stops polling when leaving a conversation", () => {
		// Otherwise every session opened this run keeps polling in the
		// background for as long as the app is open.
		expect(script).toContain("clearInterval(timer)");
	});
});

describe("theming", () => {
	const script = scriptBody();

	it("maps the desktop's token names rather than renaming them server-side", () => {
		// Keeps the desktop the single source of truth for what a theme is.
		expect(script).toContain('"--bg": "background"');
		expect(script).toContain('"--accent": "primary"');
	});

	it("remembers the choice across launches", () => {
		expect(script).toContain('localStorage.getItem("gs-theme")');
		expect(script).toContain('localStorage.setItem("gs-theme"');
	});

	it("keeps the OS status bar in step with the theme", () => {
		// Most of what stops an installed PWA looking like a web page in a
		// costume.
		expect(script).toContain('meta[name="theme-color"]');
	});

	it("survives the theme request failing", () => {
		// The stylesheet ships a fallback palette; a failed fetch must leave it
		// in place rather than render an unstyled app.
		expect(script).toContain(
			"catch(function () { /* fallback palette stays */ }",
		);
	});
});

describe("sessions list", () => {
	const script = scriptBody();

	it("splits Active from History", () => {
		expect(script).toContain('sectionHeader("Active"');
		expect(script).toContain('sectionHeader("History"');
	});

	it("shows a running session once, not in both lists", () => {
		// Without this the same conversation appears twice and the counts lie.
		expect(script).toContain("liveIds[s.sessionId]");
	});

	it("still renders Active when history is unavailable", () => {
		// History reads transcripts off disk and can legitimately fail; that
		// must not take the live list down with it.
		expect(script).toContain('api("/history").catch(');
	});
});

describe("starting a session", () => {
	const script = scriptBody();

	it("has a + in the header", () => {
		expect(MOBILE_BRIDGE_HTML).toContain('id="new"');
	});

	it("sends a workspace id, never a path", () => {
		// The server looks the directory up itself. Posting a path would turn
		// this into "run an agent anywhere on my machine".
		expect(script).toContain("workspaceId: chosen");
		expect(script).not.toContain("cwd:");
	});

	it("keeps the + off every screen but the sessions list", () => {
		// setTab hides it for all tabs; only renderSessions turns it back on.
		expect(script).toContain("newBtn.hidden = true");
		expect(script).toContain("newBtn.hidden = false");
	});

	it("hides it inside a conversation too", () => {
		const open = script.slice(script.indexOf("function openSession("));
		expect(open.slice(0, 800)).toContain("newBtn.hidden = true");
	});

	it("blocks a second tap while the first is in flight", () => {
		// Two taps would start two sessions and leave the first one unwatched.
		expect(script).toContain("go.disabled = true");
	});

	it("refuses to start on an empty prompt", () => {
		expect(script).toContain("if (!text) { box.focus(); return; }");
	});
});

describe("notifications", () => {
	const script = scriptBody();

	it("registers the worker with the token in its URL", () => {
		// The worker cannot read sessionStorage and must work while the page is
		// closed, which is exactly when a push arrives.
		expect(script).toContain(
			'navigator.serviceWorker.register("/sw.js?t=" + encodeURIComponent(TOKEN))',
		);
	});

	it("re-registers on every load so a rotated token cannot orphan it", () => {
		expect(script).toContain("function restorePush()");
		expect(script).toContain("restorePush()");
	});

	it("declares the push visible, which it is", () => {
		expect(script).toContain("userVisibleOnly: true");
	});

	it("says why the button is missing rather than hiding it silently", () => {
		expect(script).toContain("Needs the HTTPS link");
		expect(script).toContain("Blocked.");
	});

	it("warns iPhone users that it has to be installed first", () => {
		// iOS refuses push to a browser tab with no readable error.
		expect(script).toContain("Add to Home Screen");
		expect(script).toContain('matchMedia("(display-mode: standalone)")');
	});

	it("opens the session a notification points at, from open or closed", () => {
		expect(script).toContain('event.data.type === "open-session"');
		expect(script).toContain("function sessionFromHash()");
	});

	it("clears the hash so a later reload does not reopen it", () => {
		const fn = script.slice(script.indexOf("function sessionFromHash()"));
		expect(fn.slice(0, 300)).toContain("history.replaceState");
	});
});

describe("usage view", () => {
	const script = scriptBody();

	it("renders every account, not just the active one", () => {
		// The whole reason to look at this on a phone — the desktop toolbar
		// already shows the active account.
		expect(script).toContain("accounts.forEach");
	});

	it("escalates the bar colour before the limit is hit", () => {
		expect(script).toContain('w.pct >= 90 ? " hot" : w.pct >= 70 ? " warn"');
	});

	it("says so when an account has no usage yet", () => {
		// Limits are only known once an account has been used, because they are
		// read from what the CLI wrote to disk rather than fetched.
		expect(script).toContain("No usage recorded yet.");
	});
});
