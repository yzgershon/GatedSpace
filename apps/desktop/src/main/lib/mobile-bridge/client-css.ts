/**
 * The phone app's styles.
 *
 * Every colour is a CSS custom property, never a literal. The desktop's themes
 * arrive over `/api/themes` as the same token set the renderer uses, and the
 * app writes them onto `:root` — so a theme added on the desktop shows up here
 * with no work on this side, and Dracula on the phone is the same Dracula.
 *
 * Split out of the HTML because the page is now four views rather than one, and
 * a single 900-line template string is a file nobody reads twice.
 */
export const MOBILE_BRIDGE_CSS = `
:root {
  /* Fallbacks only. Overwritten the moment /api/themes answers, so the app
     never flashes an unstyled frame if that request is slow. */
  --bg: #0e0e0e;
  --fg: #ededed;
  --card: #151515;
  --border: #232323;
  --muted: #8f8f8f;
  --accent: #d97757;
  --accent-fg: #151110;
  --success: #4ade80;
  --warning: #d4a84b;
  --danger: #f87171;
  --radius: 12px;
}

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

/*
 * The hidden attribute only sets "display: none" through the browser's own
 * default stylesheet, which ANY explicit display rule outranks. Every piece of
 * chrome here sets one — footer, nav and .iconbtn are all flex — so hiding them
 * from JavaScript did nothing at all: the composer sat over the tab bar on
 * every screen, and Back and "+" were always visible.
 *
 * One rule, and hidden means hidden everywhere.
 */
[hidden] { display: none !important; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif;
  /* Only the top and sides here. The tab bar owns the bottom inset, or the
     safe area gets counted twice and leaves a dead band above the home bar. */
  padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
  overscroll-behavior-y: none;
}

/* ---- chrome ---- */
header {
  padding: 12px 16px;
  display: flex; align-items: center; gap: 10px;
  position: sticky; top: 0; z-index: 3;
  background: color-mix(in oklab, var(--bg) 88%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
}
h1 { font-size: 17px; margin: 0; font-weight: 650; flex: 1; letter-spacing: -0.01em; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
.dot.on { background: var(--success); box-shadow: 0 0 0 3px color-mix(in oklab, var(--success) 22%, transparent); }
.ver { font-size: 10px; color: color-mix(in oklab, var(--muted) 55%, transparent); font-family: ui-monospace, monospace; }
.iconbtn {
  background: none; border: 0; color: var(--muted); padding: 6px;
  min-height: auto; display: flex; align-items: center; border-radius: 8px;
}
.iconbtn:active { background: var(--card); }
/* The "+" is the one action in the header, so it reads as the accent. */
#new { font-size: 22px; line-height: 1; color: var(--accent); padding: 2px 8px 5px; }

/* ---- starting a session ---- */
.newprompt { margin-bottom: 4px; }
/* A workspace row is a CHOICE, not a link: it gets a target, not a chevron. */
.row.pick { cursor: pointer; }
.row.pick.sel {
  border-color: color-mix(in oklab, var(--accent) 60%, var(--border));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent);
}
.row.pick.sel .name { color: var(--accent); }
button.primary {
  width: 100%; margin-top: 14px; background: var(--accent); color: var(--accent-fg);
  border: 0; font-weight: 600;
}

main { padding: 12px 16px 96px; }

/* ---- tab bar ---- */
nav {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 4;
  display: flex;
  background: color-mix(in oklab, var(--bg) 92%, transparent);
  backdrop-filter: blur(16px);
  border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  padding-bottom: env(safe-area-inset-bottom);
}
nav button {
  flex: 1; background: none; border: 0; color: var(--muted);
  padding: 9px 0 7px; display: flex; flex-direction: column; align-items: center; gap: 3px;
  font: inherit; font-size: 10px; font-weight: 500; letter-spacing: .02em;
  min-height: auto;
  /* Colour only, no transform: a tab that moves on tap reads as a mis-hit. */
  transition: color .15s ease;
}
nav button.sel { color: var(--accent); }
nav svg { width: 21px; height: 21px; }

/* ---- lists ---- */
.sec { margin: 18px 0 8px; display: flex; align-items: center; gap: 8px; }
.sec h2 {
  font-size: 11px; margin: 0; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: .07em;
}
.sec .count {
  font-size: 11px; color: var(--muted); background: var(--card);
  padding: 1px 7px; border-radius: 99px;
}
.row {
  padding: 13px 14px; border: 1px solid var(--border); border-radius: var(--radius);
  margin-bottom: 8px; background: var(--card);
  display: flex; align-items: center; gap: 11px;
  transition: transform .12s ease, background .12s ease;
}
.row:active { transform: scale(0.985); background: color-mix(in oklab, var(--card) 80%, var(--fg) 6%); }
.row .body { min-width: 0; flex: 1; }
.row .name {
  font-weight: 550; font-size: 14.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row .sub { color: var(--muted); font-size: 12.5px; margin-top: 1px; }
.pip { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--muted); }
.pip.run { background: var(--success); animation: breathe 2s ease-in-out infinite; }
@keyframes breathe { 0%,100% { opacity: 1 } 50% { opacity: .45 } }

.muted { color: var(--muted); font-size: 13px; }
.empty { text-align: center; color: var(--muted); padding: 40px 20px; font-size: 14px; }

/* ---- conversation ---- */
/* The context meter sits above the transcript, where it is read before
   sending rather than gone looking for afterwards. */
.ctx {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--card); padding: 10px 12px; margin-bottom: 12px;
}
.ctx .win { margin-top: 0; font-size: 12.5px; }
.ctx .bar { margin-top: 7px; }
.earlier {
  width: 100%; margin-bottom: 12px; background: var(--card); color: var(--muted);
  border: 1px solid var(--border); font-weight: 500; font-size: 13px;
}
.turn { padding: 12px 0; }
.turn + .turn { border-top: 1px solid color-mix(in oklab, var(--border) 55%, transparent); }
.who {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em;
  color: var(--muted); margin-bottom: 4px; font-weight: 600;
}
.you .who { color: var(--accent); }
/* The working mark. Sized like a line of text so it does not shift the
   conversation when it appears and disappears between turns. */
.thinking { padding: 12px 0 4px; display: flex; align-items: center; }
.thinking .mark {
  font-family: ui-monospace, monospace; font-size: 16px; line-height: 1;
  color: var(--accent); width: 16px; text-align: center;
}
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }

/* ---- attachments ---- */
/* Sits directly ABOVE the composer and moves with it, so what is about to be
   sent is visible without covering the conversation. */
#shelf {
  position: fixed; left: 0; right: 0; z-index: 5;
  bottom: calc(60px + env(safe-area-inset-bottom));
  display: flex; gap: 8px; overflow-x: auto;
  padding: 8px 12px;
  background: color-mix(in oklab, var(--bg) 92%, transparent);
  backdrop-filter: blur(16px);
  border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
}
.chip { position: relative; flex: none; }
.chip img {
  height: 54px; width: 54px; object-fit: cover;
  border-radius: 9px; border: 1px solid var(--border); display: block;
}
/* Deliberately large for a 54px thumbnail: removing the wrong screenshot
   because the target was too small is worse than the button looking heavy. */
.chip .x {
  position: absolute; top: -6px; right: -6px;
  width: 21px; height: 21px; min-height: 0; padding: 0;
  border-radius: 50%; font-size: 14px; line-height: 1;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
}

/* ---- composer ---- */
footer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;
  background: color-mix(in oklab, var(--bg) 92%, transparent);
  backdrop-filter: blur(16px);
  border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  padding: 9px 12px calc(9px + env(safe-area-inset-bottom));
  display: flex; gap: 8px; align-items: flex-end;
}
textarea {
  flex: 1; resize: none; background: var(--card); color: inherit;
  border: 1px solid var(--border); border-radius: 11px; padding: 10px 12px;
  font: inherit; min-height: 42px; max-height: 140px;
}
textarea:focus { outline: none; border-color: color-mix(in oklab, var(--accent) 55%, var(--border)); }
button {
  background: var(--accent); color: var(--accent-fg); border: 0; border-radius: 11px;
  padding: 0 16px; font: inherit; font-weight: 600; min-height: 42px;
}
button:disabled { opacity: .4; }
/*
 * Send is a 42px square arrow, not the word "Send" in a padded pill.
 *
 * The composer is ONE ROW on a phone and every pixel it spends is width the
 * prompt does not get. The text button was ~74px; this is 42px, and dropping
 * the mic beside it gave back another 50 including its gap. That is roughly a
 * hundred pixels back to the typing area on a device that has none to spare.
 */
#send, #attach {
  padding: 0; width: 42px; display: flex; align-items: center; justify-content: center;
}
#attach {
  background: var(--card); color: var(--fg); border: 1px solid var(--border);
}
#attach:active { background: color-mix(in oklab, var(--card) 80%, var(--fg) 8%); }
#send:active { background: color-mix(in oklab, var(--accent) 85%, #000 15%); }

/* ---- usage ---- */
.acct { border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); padding: 14px; margin-bottom: 10px; }
.acct .top { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.acct .label { font-weight: 600; font-size: 14.5px; flex: 1; }
.tag {
  font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  background: color-mix(in oklab, var(--accent) 18%, transparent); color: var(--accent);
  padding: 2px 7px; border-radius: 99px;
}
.bar { height: 7px; border-radius: 99px; background: color-mix(in oklab, var(--fg) 10%, transparent); overflow: hidden; margin-top: 9px; }
.bar > i { display: block; height: 100%; border-radius: 99px; background: var(--accent); transition: width .4s ease; }
.bar.warn > i { background: var(--warning); }
.bar.hot > i { background: var(--danger); }
.win { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-top: 7px; }

/* ---- settings ---- */
.opt {
  display: flex; align-items: center; gap: 11px; padding: 13px 14px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--card); margin-bottom: 8px;
}
.opt .body { flex: 1; min-width: 0; }
.opt .name { font-weight: 550; font-size: 14.5px; }
.swatch { display: flex; gap: 3px; flex: none; }
.swatch i { width: 13px; height: 13px; border-radius: 4px; display: block; }
.check { color: var(--accent); flex: none; }
.opt.sel {
  border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent);
}
/* Read-only key/value rows. Bordered like a card so they group as one block
   rather than reading as more tappable options. */
.facts {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--card); padding: 12px 14px; margin-bottom: 10px;
}
.facts .win:first-child { margin-top: 0; }
button.danger {
  width: 100%; background: transparent; color: var(--danger);
  border: 1px solid color-mix(in oklab, var(--danger) 40%, var(--border));
  font-weight: 500;
}

.hint { padding: 8px 2px 0; font-size: 12px; color: var(--muted); }
.hint.warn { color: var(--warning); }
.err { color: var(--danger); padding: 14px 0; }
`;
