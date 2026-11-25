/** Duet-informed spacing and navigation, using GatedSpace's actual theme tokens. */
export const MOBILE_HUB_CSS = `
:root { --dock-space: 82px; }
body { letter-spacing: -.012em; }
header { max-width: 900px; margin: 0 auto; padding: 10px 16px 8px; gap: 12px; border: 0; min-height: 82px; display:grid; grid-template-columns:44px minmax(0,1fr) 44px; background:linear-gradient(var(--bg) 68%,color-mix(in srgb,var(--bg) 94%,transparent)); backdrop-filter:none; }
.mobile-brand { min-width: 0; display: flex; flex-direction:column; gap: 5px; align-items: center; justify-content: center; }
.mobile-brand img { width: 48px; height: 48px; padding:8px; border:1px solid color-mix(in srgb,var(--border) 70%,transparent); border-radius:50%; background:var(--card); }
.mobile-brand h1 { min-width:0; max-width: 100%; font-size: 12px; font-weight:500; color:var(--muted); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; }
header .iconbtn { min-width: 44px; height: 44px; padding: 11px; align-self:start; margin-top:2px; justify-content: center; color: var(--fg); border: 1px solid color-mix(in oklab,var(--border) 70%,transparent); border-radius: 50%; background: var(--card); }
header .iconbtn svg { width: 21px; height: 21px; }
#new { padding: 8px 14px; font-size: 13px; width: auto; height: 40px; background:var(--card); border:1px solid var(--border); border-radius:99px; margin-top:18px; }
#back { font-size: 27px; line-height: 1; }
body:has(#back:not([hidden])) #space-menu { display: none; }
#profile-menu { position: relative; padding:5px; }
#profile-menu svg,#profile-menu img { width:32px; height:32px; border-radius:50%; object-fit:cover; }
#profile-menu .dot { position: absolute; right: 1px; bottom: 1px; width: 7px; height: 7px; outline: 3px solid var(--bg); }
#ver { display: none; }
main { max-width: 760px; padding: 12px 22px calc(var(--dock-space) + 24px + env(safe-area-inset-bottom)); }
.hub-heading { padding: 14px 0 20px; position: relative; }
.hub-heading h2 { font-size: clamp(23px,5.7vw,28px); line-height: 1.2; font-weight: 570; letter-spacing: -.035em; margin: 0 0 9px; max-width: 370px; text-wrap: balance; }
.hub-heading p { font-size: 14px; margin: 0; max-width: 30em; line-height: 1.6; }
.heading-action { margin-top: 20px; background: var(--accent); color: var(--accent-fg); border: none; border-radius: 99px; padding: 10px 17px; font-size: 13px; font-weight: 650; }
main > input[type=search] { width: 100%; padding: 13px 16px; background: color-mix(in oklab,var(--card) 80%,transparent); border: 1px solid var(--border); border-radius: 15px; color: var(--fg); font-size: 16px; }
.agent-filters { margin-top: 16px; }
.agent-filters button { font-size: 12px; border: none; padding: 8px 13px; }
.sec { margin: 26px 0 10px; }
.sec h2 { text-transform: none; font-size: 13px; letter-spacing: 0; color: var(--fg); font-weight: 550; }
.sec .count { background: none; }
button.row { background: none; border: 0; border-bottom: 1px solid color-mix(in oklab,var(--border) 65%,transparent); border-radius: 0; margin: 0; padding: 17px 2px; min-height: 76px; }
.row .name { font-size: 15px; font-weight: 560; }
.row .sub { margin-top: 4px; font-size: 12px; }
.row .pip { width: 10px; height: 10px; margin: 0 8px; flex-shrink: 0; }
#mobile-dock { display:flex; gap:9px; width:min(410px,calc(100% - 32px)); position:fixed; z-index:5; left:50%; transform:translateX(-50%); bottom:calc(15px + env(safe-area-inset-bottom)); }
#mobile-dock:has(#tabs[hidden]) { display:none; }
nav#tabs { position:static; flex:1; min-width:0; padding:5px; border:1px solid color-mix(in oklab,var(--border) 80%,var(--fg) 10%); border-radius:38px; background:var(--card); box-shadow:0 7px 28px #0002; }
nav#tabs button { min-width:0; min-height:46px; border-radius:26px; font-size:10px; gap:2px; padding:4px 0; color:var(--muted); letter-spacing:0; border:1px solid transparent; }
nav#tabs button.sel { color:var(--fg); background:color-mix(in oklab,var(--fg) 9%,var(--card)); border-color:color-mix(in oklab,var(--fg) 32%,var(--border)); }
nav#tabs svg { width:21px; height:21px; }
#computer-menu { width:58px; height:58px; flex:none; display:grid; place-items:center; padding:16px; border-radius:50%; color:var(--fg); background:var(--card); border:1px solid var(--border); box-shadow:0 7px 28px #0002; }
#computer-menu svg { width:24px; height:24px; }
#composer { width: min(716px,calc(100% - 32px)); left: 50%; right: auto; transform: translateX(-50%); bottom: calc(var(--dock-space) + env(safe-area-inset-bottom) + var(--keyboard-inset,0px)); padding: 7px; gap: 3px; border: 1px solid color-mix(in oklab,var(--border) 75%,var(--fg) 14%); border-radius: 23px; background: var(--card); box-shadow: 0 4px 20px #0001; }
#composer:focus-within { border-color: color-mix(in oklab,var(--accent) 60%,var(--border)); }
#input { border: 0; background: none; font-size: 16px; padding: 8px 4px; line-height: 1.5; }
#input:focus { outline: none; }
#composer button { width: 38px; height: 38px; min-height: 38px; padding: 8px; border-radius: 50%; flex-shrink: 0; display:grid; place-items:center; }
#composer #stop { width:38px; padding:8px; border:1px solid var(--border); background:color-mix(in oklab,var(--fg) 7%,var(--card)); color:var(--fg); }
#composer #stop svg { width:20px; height:20px; display:block; }
#shelf { width: min(716px,calc(100% - 32px)); left: 50%; right: auto; transform: translateX(-50%); bottom: calc(var(--dock-space) + env(safe-area-inset-bottom) + var(--composer-height,64px) + var(--keyboard-inset,0px) + 6px); border-radius: 16px; border: 1px solid var(--border); padding: 8px; background: var(--card); }
body:has(#composer:not([hidden])) main { padding-bottom: calc(var(--dock-space) + env(safe-area-inset-bottom) + var(--composer-height,64px) + var(--shelf-height,0px) + var(--keyboard-inset,0px) + 24px); }
.hint { width: min(716px,calc(100% - 32px)); left: 50%; right: auto; transform: translateX(-50%); bottom: calc(var(--dock-space) + env(safe-area-inset-bottom) + var(--composer-height,64px) + var(--shelf-height,0px) + var(--keyboard-inset,0px) + 8px); }
.keyboard-open { --dock-space: 0px; }
.keyboard-open #mobile-dock { display: none; }
.keyboard-open #composer { bottom: calc(var(--keyboard-inset,0px) + 6px); }
.turn { margin: 10px 0; }
.turn.you { width:fit-content; max-width:90%; margin:24px 0 22px auto; border:none; padding:12px 16px; background:color-mix(in oklab,var(--fg) 7%,var(--card)); border-radius:22px; }
[data-provider=claude] { --reply-color:#bb6036; }
[data-provider=codex] { --reply-color:#8b72d7; }
.turn.assistant { width:fit-content; max-width:94%; background:color-mix(in srgb,var(--reply-color) 7%,var(--card)); border:1px solid color-mix(in srgb,var(--reply-color) 9%,var(--border)); border-radius:20px; padding:12px 15px; margin:8px 0; }
.message-text { font-size:var(--message-size,15px); line-height:1.6; }
.typing-bubble { width:58px; height:34px; display:flex; align-items:center; justify-content:center; gap:5px; margin:8px 0 14px; border-radius:18px; background:color-mix(in srgb,var(--reply-color) 7%,var(--card)); }
.typing-bubble i { width:6px; height:6px; border-radius:50%; background:var(--fg); opacity:.5; animation:reply-dot 1.35s ease-in-out infinite; }
.typing-bubble i:nth-of-type(2) { animation-delay:.16s; }
.typing-bubble i:nth-of-type(3) { animation-delay:.32s; }
@keyframes reply-dot { 0%,65%,100% { opacity:.35; transform:translateY(0); } 32% { opacity:.95; transform:translateY(-2px); } }
.conversation-status { margin:15px 0; color:var(--muted); font-size:12px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
body[data-motion=reduced] *,body[data-motion=reduced] *::before,body[data-motion=reduced] *::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; }
body[data-view=conversation] main { max-width:var(--transcript-width,760px); }
body[data-view=conversation] #composer,body[data-view=conversation] #shelf { width:min(calc(var(--transcript-width,760px) - 44px),calc(100% - 32px)); }
.reply-choice { font-weight:400; line-height:1.6; overflow-wrap:anywhere; }
.hub-filters { display: flex; gap: 5px; margin: 8px 0 22px; }
.hub-filters button { min-height: 38px; padding: 8px 13px; border: 0; border-radius: 12px; background: none; color: var(--muted); font-size: 13px; }
.hub-filters button[aria-pressed=true] { background: color-mix(in oklab,var(--fg) 8%,var(--card)); color: var(--fg); }
.task-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:10px; }
.task-toolbar .hub-filters { margin:0 0 12px; gap:9px; }.task-toolbar .hub-filters button { font-size:23px; padding:5px 9px; border-radius:9px; font-weight:550; }
.task-toolbar select { width:auto; max-width:112px; margin:0; font-size:12px; border:0; background:none; }
.task-row { display: flex; width: 100%; align-items: flex-start; text-align: left; padding: 25px 2px; gap: 14px; color: var(--fg); background: none; border: 0; }
.task-row[data-done=true] .task-mark { color:var(--success); border-color:var(--success); }
.task-body .muted { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.quick-task { position:fixed; z-index:4; bottom:calc(var(--dock-space) + env(safe-area-inset-bottom) + var(--keyboard-inset,0px)); width:min(716px,calc(100% - 32px)); left:50%; transform:translateX(-50%); padding:7px 10px 7px 18px; display:flex; flex-wrap:wrap; align-items:center; gap:8px; border:1px solid var(--border); border-radius:30px; background:var(--card); }
.quick-task input { min-width:0; flex:1; margin:0; border:0; background:none; font-size:16px; padding:10px 0; color:var(--fg); }
.quick-task-add { border:0; width:40px; height:40px; border-radius:50%; font-size:26px; background:var(--fg); color:var(--bg); }
.quick-task .hub-error { flex-basis:100%; margin:0; font-size:12px; }
body[data-view=tasks] main { padding-bottom:calc(var(--dock-space) + 100px + env(safe-area-inset-bottom)); }
.task-mark { width: 21px; height: 21px; border: 1.5px solid var(--muted); border-radius: 50%; margin-top: 3px; flex: none; font-size: 13px; text-align: center; color: var(--accent); }
.task-body { flex: 1; min-width: 0; display: flex; gap: 5px; flex-direction: column; }
.task-body strong { font-weight: 550; overflow-wrap: anywhere; }
.task-body .muted,.task-time { font-size: 12px; }
.task-time { color: var(--muted); white-space: nowrap; padding-top: 4px; }
.hub-empty { grid-column: 1/-1; padding: 52px 16px; text-align: center; max-width: 420px; margin: 0 auto; }
.empty-mark { width: 60px; height: 60px; margin: 0 auto 23px; display: grid; place-items: center; color: var(--accent); border-radius: 22px; background: color-mix(in oklab,var(--accent) 8%,var(--card)); font-size: 28px; }
.hub-empty h2 { margin: 0 0 12px; font-size: 22px; font-weight: 550; letter-spacing: -.03em; }
.hub-empty p { font-size: 14px; line-height: 1.65; }
.hub-empty .primary { width: auto; padding: 12px 22px; border-radius: 99px; font-size: 13px; }
.output-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.make-feature { margin:14px 0 26px; min-height:230px; border-radius:25px; background:color-mix(in srgb,var(--accent) 10%,var(--card)); border:1px solid color-mix(in srgb,var(--accent) 18%,var(--border)); padding:22px; text-align:center; }
.make-document { width:91px; height:105px; margin:0 auto 17px; padding:13px 12px; border:1px solid color-mix(in srgb,var(--accent) 40%,var(--border)); border-radius:10px; background:var(--card); box-shadow:0 6px 22px #0002; transform:rotate(-4deg); text-align:left; }
.make-document span { display:block; font-size:8px; font-weight:600; margin-bottom:11px; }.make-document i { display:block; height:3px; background:var(--border); margin-bottom:7px; border-radius:3px; }.make-document i:last-child { width:65%; }
.make-feature h2 { font-size:19px; font-weight:550; margin:0 0 15px; letter-spacing:-.025em; }
.make-start { font:inherit; font-size:13px; padding:10px 18px; border:1px solid color-mix(in srgb,var(--accent) 32%,var(--border)); border-radius:99px; background:var(--card); color:var(--fg); }
.make-section-title { font-size:19px; font-weight:550; margin:24px 0 14px; }
.make-templates { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.template-card { text-align:left; min-width:0; border:0; border-radius:20px; background:var(--card); color:var(--fg); padding:16px; display:flex; flex-direction:column; gap:8px; }
.template-symbol { font-size:25px; color:var(--muted); line-height:1; margin-bottom:6px; }.template-card strong { font-size:15px; font-weight:550; }.template-card .muted { font-size:12px; line-height:1.5; }
.output-card { min-width: 0; display: flex; flex-direction: column; text-align: left; background:linear-gradient(var(--card),color-mix(in srgb,var(--accent) 5%,var(--card))); border: 1px solid var(--border); border-radius: 20px; color: var(--fg); padding: 16px 12px 0; min-height: 218px; overflow:hidden; }
.output-type { font-size: 10px; color: var(--accent); }
.output-card h3 { font-size:16px; line-height:1.4; font-weight:550; margin:0 0 12px; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.output-excerpt { font-size:10px; color:var(--fg); background:color-mix(in srgb,var(--fg) 8%,var(--card)); border:1px solid color-mix(in srgb,var(--fg) 13%,var(--border)); border-bottom:0; border-radius:12px 12px 0 0; line-height:1.6; margin:18px 0 0; padding:14px 11px; height:100px; overflow:hidden; overflow-wrap:anywhere; }
.output-card > .muted { font-size: 10px; margin-top: auto; }
.hub-dialog { padding: 0; color: var(--fg); background: var(--card); border: 1px solid var(--border); border-radius: 25px; width: min(540px,calc(100% - 28px)); max-height: min(85dvh,850px); box-shadow: 0 20px 80px #0005; }
.hub-dialog::backdrop { background: #0006; backdrop-filter: blur(3px); }
.dialog-bar { display: flex; align-items: center; gap: 12px; padding: 20px 22px 12px; position: sticky; top: 0; background: var(--card); z-index: 1; }
.dialog-bar h2 { font-size: 18px; flex: 1; margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.close-dialog { border: none; background: none; font-size: 26px; color: var(--muted); height: 40px; width: 40px; flex: none; }
.dialog-body { padding: 8px 22px 24px; }
.hub-field { display: flex; flex-direction: column; gap: 9px; font-size: 12px; color: var(--muted); margin: 14px 0 20px; }
.hub-field input,.hub-field textarea,.hub-field select { width: 100%; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in oklab,var(--bg) 45%,var(--card)); color: var(--fg); font-size: 16px; padding: 12px; }
.dialog-body .primary { border-radius: 14px; min-height: 46px; }
.dialog-body > .muted { font-size: 13px; }
.drawer-row { display: block; width: 100%; text-align: left; padding: 15px 0; color: var(--fg); font-size: 14px; background: none; border: 0; border-bottom: 1px solid color-mix(in oklab,var(--border) 60%,transparent); }
.drawer-row:hover { color: var(--accent); }
.drawer-label { color: var(--muted); font-size: 12px; font-weight: 500; margin: 28px 0 10px; }
.conversation-link { width:100%; display:flex; align-items:center; gap:12px; padding:12px 9px; border:0; border-radius:13px; background:none; color:var(--fg); text-align:left; }
.conversation-link:hover,.conversation-link[aria-current=page] { background:color-mix(in oklab,var(--fg) 7%,transparent); }
.conversation-label { min-width:0; flex:1; display:flex; flex-direction:column; gap:3px; }
.conversation-label strong { font-size:14px; font-weight:550; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; }
.conversation-label .muted,.conversation-time { font-size:11px; }
.conversation-time { color:var(--muted); flex:none; }
.agent-mark { width:29px; height:29px; border-radius:10px; display:grid; place-items:center; flex:none; color:color-mix(in srgb,var(--reply-color) 65%,var(--fg)); background:color-mix(in srgb,var(--reply-color) 17%,transparent); font-size:19px; }
.agent-mark[data-provider=codex],.conversation-link[data-provider=codex] .agent-mark { font-size:13px; font-weight:650; }
.channel-drawer input[type=search] { font-size:14px; margin:0 0 12px; }
.computer-identity { display:flex; align-items:center; gap:16px; margin:8px 0 20px; padding:20px 14px; background:var(--card); border-radius:20px; }
.computer-symbol { width:54px; height:54px; border-radius:17px; display:grid; place-items:center; background:color-mix(in oklab,var(--fg) 6%,transparent); }
.computer-symbol svg { width:28px; height:28px; }.computer-symbol span { display:none; }
.computer-identity h3 { font-weight:550; font-size:18px; margin:0 0 3px; }
.computer-online { font-size:12px; color:var(--success); }
.computer-sheet { width:min(760px,100%); max-width:min(760px,100%); height:100dvh; max-height:none; margin:0 auto; border:0; border-radius:0; background:var(--bg); }
.computer-sheet .dialog-bar { display:grid; grid-template-columns:44px minmax(0,1fr) 44px; padding:calc(16px + env(safe-area-inset-top)) 16px 22px; background:var(--bg); }
.computer-sheet .dialog-bar h2 { text-align:center; font-size:20px; }
.computer-refresh { width:44px; height:44px; border:0; border-radius:50%; background:none; color:var(--fg); font-size:30px; }
.computer-new { width:100%; padding:18px; border:0; border-radius:20px; font-size:19px; background:var(--card); color:var(--fg); text-align:left; }
.computer-checked { color:var(--muted); font-size:12px; margin:20px 0 32px; }
.computer-sheet .conversation-link { padding:14px 12px; }
.settings-heading h2 { font-size:28px; font-weight:550; letter-spacing:-.035em; margin:18px 0 8px; }
.settings-heading p { font-size:13px; }
.settings-sections { display:flex; gap:5px; overflow-x:auto; padding:12px 0; scrollbar-width:thin; }
.settings-sections button { flex:none; font-size:12px; border:0; border-radius:99px; padding:10px 14px; color:var(--muted); background:none; }
.settings-sections button[aria-pressed=true] { color:var(--fg); background:var(--card); }
.settings-label { font-size:15px; font-weight:600; margin:26px 0 8px; }
.preference-row { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:12px; padding:18px 0; border-bottom:1px solid var(--border); }
.preference-copy { flex:1 1 170px; min-width:0; }.preference-copy strong { font-size:14px; font-weight:500; }.preference-copy p { font-size:12px; line-height:1.5; margin:5px 0 0; }
.preference-control { display:flex; align-items:center; gap:7px; max-width:100%; }.preference-control select { font-size:13px; margin:0; width:auto; max-width:240px; min-height:40px; }
.preference-segment { display:flex; padding:3px; border-radius:12px; background:var(--card); }
.preference-segment button { padding:8px 12px; border:0; border-radius:9px; background:none; color:var(--muted); font-size:12px; min-height:36px; }
.preference-segment button[aria-pressed=true] { background:color-mix(in oklab,var(--fg) 11%,transparent); color:var(--fg); }
.setting-action { font-size:12px; padding:9px 13px; border:1px solid var(--border); border-radius:99px; background:var(--card); color:var(--fg); }
.settings-note,.settings-content>p { color:var(--muted); font-size:13px; line-height:1.65; }
.settings-sheet { width:min(600px,100%); max-width:min(600px,100%); height:91dvh; max-height:91dvh; margin:auto auto 0; border:1px solid var(--border); border-bottom:0; border-radius:32px 32px 0 0; background:var(--bg); padding-bottom:env(safe-area-inset-bottom); }
.settings-sheet .dialog-bar { min-height:78px; display:flex; justify-content:center; padding:24px 80px 16px; background:var(--bg); border-radius:32px 32px 0 0; }
.settings-sheet .dialog-bar::before { content:""; position:absolute; top:10px; left:50%; transform:translateX(-50%); width:39px; height:5px; border-radius:99px; background:color-mix(in srgb,var(--muted) 70%,transparent); }
.settings-sheet .dialog-bar h2 { text-align:center; font-size:19px; }
.settings-sheet .sheet-done { position:absolute; right:16px; bottom:16px; width:auto; height:43px; padding:8px 15px; font-size:16px; border:1px solid var(--border); border-radius:99px; background:var(--card); color:var(--fg); }
.sheet-back { position:absolute; left:16px; bottom:16px; height:43px; width:43px; border:0; background:none; color:var(--fg); font-size:30px; border-radius:50%; }
.settings-sheet .dialog-body { padding:0 13px 30px; }
.settings-group { margin:10px 0 22px; }.settings-group .settings-label { margin:0 12px 9px; color:var(--muted); font-size:13px; font-weight:400; }
.settings-group-rows { border-radius:22px; background:var(--card); overflow:hidden; }
.settings-link { display:flex; align-items:center; gap:12px; width:100%; min-height:56px; padding:12px 15px; border:0; border-bottom:1px solid var(--bg); text-align:left; background:none; color:var(--fg); }
.settings-link:last-child { border-bottom:0; }.settings-link:hover { background:color-mix(in srgb,var(--fg) 4%,transparent); }
.settings-icon { width:27px; height:27px; flex:none; color:var(--muted); display:grid; place-items:center; }.settings-icon svg { width:25px; height:25px; }.settings-icon .settings-avatar { width:35px; height:35px; border-radius:50%; object-fit:cover; }
.settings-link-label { flex:1; min-width:0; font-size:15px; overflow-wrap:anywhere; }.settings-value { color:var(--muted); font-size:12px; max-width:38%; text-align:right; }.settings-chevron { font-size:24px; line-height:1; color:var(--muted); }
.settings-group-rows .preference-row { padding:17px; border:0; }.settings-group-rows > .muted { margin:0 17px 18px; font-size:12px; }
.settings-content { padding:0 8px; }.settings-content .preference-row { padding:18px 12px; background:var(--card); }.settings-content .preference-row:first-of-type { border-radius:18px 18px 0 0; }.settings-content .preference-row:last-child { border-radius:0 0 18px 18px; }
.settings-sheet .preference-copy strong { font-size:16px; }.settings-content .preference-control { flex-wrap:wrap; }
.theme-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; padding:8px 0 15px; }
.theme-card { min-width:0; padding:6px; border:1px solid var(--border); border-radius:17px; background:var(--card); color:var(--fg); text-align:left; font-size:12px; font-weight:500; }
.theme-card[aria-pressed=true] { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
.theme-preview { height:82px; display:flex; flex-direction:column; gap:8px; border-radius:11px; padding:11px; }
.theme-preview i { display:block; height:13px; border-radius:6px; }.theme-preview-top { width:30%; background:var(--theme-accent); height:5px!important; opacity:.8; }.theme-preview-user { width:60%; align-self:flex-end; background:var(--theme-surface); }.theme-preview-reply { width:75%; background:color-mix(in srgb,var(--theme-accent) 10%,var(--theme-surface)); }
.theme-name { display:block; padding:8px 5px 4px; }
.channel-drawer { margin:0 auto 0 0; height:100dvh; max-height:none; width:min(370px,calc(100% - 48px)); border:0; border-right:1px solid var(--border); border-radius:0 25px 25px 0; background:var(--bg); }
.channel-drawer::backdrop { backdrop-filter:none; background:#0005; }
.channel-drawer .dialog-bar { background:var(--bg); padding:calc(22px + env(safe-area-inset-top)) 18px 22px; gap:9px; }
.drawer-brand { width:31px; height:31px; border-radius:10px; }.channel-drawer .dialog-bar h2 { font-size:20px; }.channel-drawer .close-dialog { width:32px; }
.channel-drawer .dialog-body { padding:0 15px 25px; }.channel-drawer .home-link { background:var(--card); border:1px solid var(--border); padding:16px; border-radius:22px; font-size:18px; }
.channel-drawer .drawer-row:not(.home-link) { border:0; padding:16px 12px; }
.channel-drawer input[type=search] { width:100%; background:var(--card); border:1px solid var(--border); padding:11px 13px; border-radius:14px; color:var(--fg); }
body:has(dialog[open]) { overflow:hidden; }
.app-version { font-size: 11px; color: var(--muted); margin-top: 24px; }
.task-notes { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.65; }
.saved-output { font-size: 15px; line-height: 1.7; overflow-wrap: anywhere; }
.saved-output pre { max-width: 100%; overflow: auto; }
.output-actions { display: flex; gap: 10px; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 18px; margin-top: 24px; }
.output-actions button { font-size: 12px; background: none; color: var(--fg); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; }
@media (max-width:360px) { main { padding-left:16px; padding-right:16px; } header { padding-left:12px; padding-right:12px; gap:5px; } .output-grid { gap:8px; }.output-card { padding:14px 9px 0; }.output-card h3 { font-size:14px; }.settings-value { max-width:30%; }.settings-link { gap:10px; padding:12px; } }
@media (min-width:1000px) { .hub-heading { padding-top: 42px; } main { max-width: 780px; } .output-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } }
@media (prefers-reduced-motion:no-preference) {
  button { transition:background-color .18s,border-color .18s,transform .14s cubic-bezier(.2,.75,.2,1); }
  button:active:not(:disabled) { transform:scale(.97); }
  .hub-dialog[open] { animation:sheet-enter .28s cubic-bezier(.2,.8,.2,1); }
  .channel-drawer[open] { animation:drawer-enter .28s cubic-bezier(.2,.8,.2,1); }
  @keyframes sheet-enter { from { opacity:0; translate:0 24px; } to { opacity:1; translate:0 0; } }
  @keyframes drawer-enter { from { translate:-40px 0; opacity:.4; } to { translate:0 0; opacity:1; } }
}
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }
`;
