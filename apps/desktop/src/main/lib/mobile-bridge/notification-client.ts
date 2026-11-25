/** Shared notification routing for a focused page and a cold PWA launch. */
export const MOBILE_NOTIFICATION_CLIENT_JS = `
function notificationTarget(key, provider) {
  if (typeof key !== "string" || !key || key.length > 512) return null;
  var known = provider === "claude" || provider === "codex" ? provider : null;
  var prefix = /^(claude|codex):/.exec(key);
  return {key:key, provider:known || (prefix && prefix[1]) || null};
}
function sessionFromHash() {
  var params = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var target = notificationTarget(params.get("session"), params.get("provider"));
  if (target) history.replaceState(null, "", location.pathname + location.search);
  return target;
}
function openNotifiedSession(key, provider) {
  var target = notificationTarget(key, provider);
  if (!target) return Promise.resolve();
  if (target.provider) {
    openSession(target.key, target.provider);
    return Promise.resolve();
  }
  // Older notifications have only a pane key, which does not identify an AI.
  // Resolve against the host rather than silently opening Codex as Claude.
  var generation = viewGeneration;
  return api("/mobile/sessions").then(function (data) {
    if (generation !== viewGeneration) return;
    var matches = (data.sessions || []).filter(function (session) {
      return session.key === target.key && (session.provider === "claude" || session.provider === "codex");
    });
    if (matches.length === 1) openSession(target.key, matches[0].provider);
    else fail("This session is no longer available from its notification. Find it in Sessions.");
  }).catch(function (error) { if (generation === viewGeneration) fail(error.message); });
}
`;
