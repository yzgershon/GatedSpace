/**
 * The status line GatedSpace installs into Claude Code.
 *
 * Claude Code renders a single line under its prompt by running a command and
 * printing its stdout (settings.json → statusLine). This script is that
 * command: it shows the model, git branch, 5-hour and weekly subscription
 * usage with reset countdowns, context-window fill, and session cost.
 *
 * It also persists each reply's rate-limit payload to
 * `<configDir>/cache/rate-limits.json`. That snapshot is the ONLY local source
 * of real subscription limits — GatedSpace's Usage popup and the account
 * auto-failover both read it, and neither makes any network call. Without a
 * status line installed, those features have nothing to show.
 *
 * Kept as a string (not a bundled asset) so it survives asar packaging with no
 * extra build wiring. Authored without backticks or ${...} so String.raw can
 * carry the backslashes in the ANSI escapes through verbatim.
 */

export const STATUS_LINE_MARKER = "GATEDSPACE_STATUS_LINE";

export const STATUS_LINE_SCRIPT = String.raw`#!/usr/bin/env node
/*
 * GatedSpace status line for Claude Code.  GATEDSPACE_STATUS_LINE
 *
 * Installed by GatedSpace (Settings, or the Usage popup). Safe to delete —
 * remove the "statusLine" entry from the matching Claude settings.json too.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (c) { raw += c; });
process.stdin.on('end', function () {
  let d = {};
  try { d = JSON.parse(raw); } catch (e) { /* print a minimal line below */ }

  // Which Claude account this session belongs to. The launcher sets
  // CLAUDE_CONFIG_DIR per profile; unset means the default account.
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

  // Persist the latest rate-limit snapshot so local tools (the GatedSpace
  // Usage popup, account auto-failover) can read real 5h/weekly quota without
  // any API call. Best-effort: never break the status line over it.
  if (d.rate_limits && (d.rate_limits.five_hour || d.rate_limits.seven_day)) {
    try {
      const dir = path.join(configDir, 'cache');
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, 'rate-limits.json');
      const tmp = out + '.tmp';
      const payload = Object.assign({}, d.rate_limits, {
        plan: (d.subscription && d.subscription.plan) || null,
        updatedAt: Date.now()
      });
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, out);
    } catch (e) { /* ignore */ }
  }

  const C = {
    reset: '\x1b[0m', dim: '\x1b[2m', gray: '\x1b[90m',
    green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
    cyan: '\x1b[36m', orange: '\x1b[38;5;208m', violet: '\x1b[38;5;141m'
  };
  // Single-space separators: the line has to fit the pane width or Claude
  // Code truncates the tail (which is where the session cost lives).
  const sep = C.gray + ' · ' + C.reset;
  const now = Math.floor(Date.now() / 1000);

  const pctColor = function (p) {
    if (p == null) return C.gray;
    if (p >= 80) return C.red;
    if (p >= 50) return C.yellow;
    return C.green;
  };
  const bar = function (p, w) {
    const width = w || 8;
    const n = Math.max(0, Math.min(width, Math.round(((p || 0) / 100) * width)));
    return '▕' + '█'.repeat(n) + '░'.repeat(width - n) + '▏';
  };
  const fmtReset = function (epoch) {
    if (!epoch) return '';
    const s = epoch - now;
    if (s <= 0) return 'now';
    const day = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (day) return day + 'd' + h + 'h';
    return h ? h + 'h' + m + 'm' : m + 'm';
  };
  // The reset glyph is ambiguous-width: some Windows fonts draw it two cells
  // wide while the terminal advances one, so it bleeds into the countdown.
  // The trailing space gives it a cell to overflow into.
  const resetTag = function (epoch) {
    const r = fmtReset(epoch);
    return r ? C.dim + ' ↻ ' + r + C.reset : '';
  };

  // Account name, shown only when more than one Claude account is configured
  // (a single-account user does not need to be told which one they are on).
  const accountLabel = function () {
    try {
      const statePath = path.join(os.homedir(), '.superset', 'claude-profile.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const profiles = state && state.profiles;
      if (!profiles) return null;
      const ids = Object.keys(profiles);
      if (ids.length < 2) return null;
      const norm = function (p) { return path.resolve(p).toLowerCase(); };
      for (let i = 0; i < ids.length; i++) {
        const entry = profiles[ids[i]] || {};
        if (typeof entry.configDir !== 'string') continue;
        const dir = (path.isAbsolute(entry.configDir) || /[\\/]/.test(entry.configDir))
          ? entry.configDir
          : path.join(os.homedir(), entry.configDir);
        if (norm(dir) === norm(configDir)) return entry.label || ids[i];
      }
    } catch (e) { /* single-account or unreadable */ }
    return null;
  };

  const parts = [];

  const model = d.model && d.model.display_name;
  if (model) parts.push(C.violet + '◆ ' + model + C.reset);

  const account = accountLabel();
  if (account) parts.push(C.cyan + account + C.reset);

  // Git branch of the session's working directory (repo name dropped to keep
  // the line narrow enough that the cost segment stays on screen).
  const cwd = (d.workspace && (d.workspace.current_dir || d.workspace.project_dir)) || d.cwd;
  if (cwd) {
    try {
      let dir = cwd;
      for (let i = 0; i < 30; i++) {
        const g = path.join(dir, '.git');
        if (fs.existsSync(g)) {
          let headPath = null;
          if (fs.statSync(g).isFile()) {
            // Worktree: .git is a file pointing at the real git dir.
            const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(g, 'utf8'));
            if (m) headPath = path.resolve(dir, m[1], 'HEAD');
          } else {
            headPath = path.join(g, 'HEAD');
          }
          let branch = null;
          if (headPath && fs.existsSync(headPath)) {
            const head = fs.readFileSync(headPath, 'utf8').trim();
            const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
            branch = ref ? ref[1] : head.slice(0, 7); // detached -> short sha
          }
          if (branch) {
            if (branch.length > 20) branch = branch.slice(0, 19) + '…';
            parts.push(C.violet + branch + C.reset);
          }
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch (e) { /* no repo segment */ }
  }

  // Subscription usage limits (Pro/Max only; appear after the first reply).
  const rl = d.rate_limits || {};
  const fh = rl.five_hour;
  const wk = rl.seven_day;
  if (fh && fh.used_percentage != null) {
    const p = Math.round(fh.used_percentage);
    parts.push(C.gray + '5h ' + C.reset + pctColor(p) + bar(p) + ' ' + p + '%' + C.reset + resetTag(fh.resets_at));
  }
  if (wk && wk.used_percentage != null) {
    const p = Math.round(wk.used_percentage);
    parts.push(C.gray + 'wk ' + C.reset + pctColor(p) + p + '%' + C.reset + resetTag(wk.resets_at));
  }
  if (!fh && !wk) {
    parts.push(C.dim + 'usage → shows after first reply' + C.reset);
  }

  // Live context-window fill.
  const cw = d.context_window || {};
  if (cw.used_percentage != null) {
    const p = Math.round(cw.used_percentage);
    const col = p >= 80 ? C.red : (p >= 50 ? C.yellow : C.cyan);
    parts.push(C.gray + 'ctx ' + C.reset + col + p + '%' + C.reset);
  }

  // Session cost (API-equivalent USD for this session).
  const usd = d.cost && d.cost.total_cost_usd;
  if (usd != null) {
    parts.push(C.green + (usd < 0.01 ? '<$0.01' : '$' + usd.toFixed(2)) + C.reset);
  }

  process.stdout.write(parts.length ? parts.join(sep) : (C.dim + 'Claude Code' + C.reset));
});
`;
