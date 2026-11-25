/** Navigation stays available in a conversation; native session IDs deduplicate tabs. */
export const MOBILE_NAVIGATION_CLIENT_JS = `
var sessionDirectory = null;
function orderedSessions(data) {
  var byId = new Map();
  (data.history || []).forEach(function(s) { byId.set(s.provider + ":" + s.sessionId, Object.assign({},s,{live:false})); });
  (data.sessions || []).forEach(function(s) {
    var id = s.provider + ":" + (s.sessionId || s.key), history = byId.get(id);
    byId.set(id,Object.assign({},history || {},s,{live:true,lastModified:Math.max(s.lastModified || 0,history && history.lastModified || 0)}));
  });
  return Array.from(byId.values()).sort(function(a,b) { return (b.lastModified || 0)-(a.lastModified || 0) || (a.title || "").localeCompare(b.title || ""); });
}
function openDirectorySession(session, button) {
  if(session.live) { openSession(session.key,session.provider); return Promise.resolve(); }
  var generation=viewGeneration;
  if(button) button.disabled=true;
  if(!session.resumeRequestId) session.resumeRequestId=requestId();
  return api("/mobile/resume",{method:"POST",body:JSON.stringify({provider:session.provider,sessionId:session.sessionId,requestId:session.resumeRequestId})})
    .then(function(res) { if(generation===viewGeneration) openSession(res.key,res.provider); })
    .catch(function(e) { if(generation===viewGeneration) fail(e.message); })
    .finally(function() { if(button) button.disabled=false; });
}
function directoryRow(session, choose) {
  var row=createButton("",function() { choose(session,row); },"conversation-link");
  row.dataset.provider=session.provider;
  if(session.key===current && session.provider===currentProvider) row.setAttribute("aria-current","page");
  var mark=hubElement("span","agent-mark",session.provider==="codex" ? "C" : "✳"); mark.setAttribute("aria-hidden","true");
  var label=hubElement("span","conversation-label");
  label.append(hubElement("strong","",session.title || (session.provider==="codex" ? "Codex" : "Claude") + " session"),hubElement("span","muted",(session.provider==="codex" ? "Codex" : "Claude") + (session.running ? " · Working" : "")));
  row.append(mark,label);
  if(session.lastModified) row.appendChild(hubElement("time","conversation-time",relTime(session.lastModified)));
  return row;
}
function openConversationMenu() {
  var view=hubDialog("GatedDuet","channel-drawer");
  var brand=document.querySelector(".mobile-brand img").cloneNode(); brand.className="drawer-brand"; view.dialog.querySelector(".dialog-bar").prepend(brand);
  view.body.appendChild(createButton("Home",function() { channelFilter=null; view.dialog.close(); setTab("sessions"); },"drawer-row home-link"));
  view.body.appendChild(createButton("+ New conversation",function() { view.dialog.close(); renderNewSession(); },"drawer-row"));
  var label=hubElement("h3","drawer-label","Recent conversations"), search=document.createElement("input");
  search.type="search"; search.placeholder="Find a conversation"; search.setAttribute("aria-label","Find a conversation");
  view.body.append(label,search);
  var list=hubElement("div","conversation-list","Loading conversations…"); view.body.appendChild(list);
  function draw(data) {
    if(!view.dialog.isConnected) return; list.replaceChildren();
    orderedSessions(data).filter(function(s) { return (s.title || "").toLowerCase().includes(search.value.toLowerCase()); }).forEach(function(s) {
      list.appendChild(directoryRow(s,function(session,button) { view.dialog.close(); openDirectorySession(session,button); }));
    });
    if(!list.children.length) list.appendChild(hubElement("p","muted","No matching conversations."));
  }
  search.oninput=function() { if(sessionDirectory) draw(sessionDirectory); };
  if(sessionDirectory) draw(sessionDirectory);
  function load() { api("/mobile/sessions").then(function(data) {
    sessionDirectory=data; draw(data);
    if(data.historyLoading && view.dialog.isConnected) setTimeout(function() { if(view.dialog.isConnected) load(); },3000);
  }).catch(function(e) { if(view.dialog.isConnected) { list.replaceChildren(hubElement("p","err",e.message),createButton("Try again",load,"drawer-row")); } }); }
  load();
  view.body.appendChild(hubElement("h3","drawer-label","Channels"));
  var channels=hubElement("div"); view.body.appendChild(channels);
  loadHub().then(function(data) {
    if(!view.dialog.isConnected) return;
    data.channels.filter(function(c) { return !c.archived; }).forEach(function(channel) {
      channels.appendChild(createButton(channel.title,function() { channelFilter=channel.id; view.dialog.close(); setTab("sessions"); },"drawer-row"));
    });
  }).catch(function(e) { if(view.dialog.isConnected) channels.textContent=e.message; });
  view.body.appendChild(createButton("+ New channel",function() { view.dialog.close(); newChannel(); },"drawer-row"));
  if(current) view.body.appendChild(createButton("Add this conversation to a channel",function() { view.dialog.close(); chooseChannelForSession(); },"drawer-row"));
  if(current) view.body.appendChild(createButton("Save a reply to Make",function() { view.dialog.close(); chooseReplyToSave(); },"drawer-row"));
}
function openComputers() {
  var view=hubDialog("Sessions","computer-sheet"), bar=view.dialog.querySelector(".dialog-bar"), close=bar.querySelector("button");
  close.setAttribute("aria-label","Close Computers"); bar.prepend(close);
  var refreshButton=createButton("↻",load,"computer-refresh"); refreshButton.setAttribute("aria-label","Refresh computers"); bar.appendChild(refreshButton);
  function load() {
  view.body.textContent="Checking your computer…"; refreshButton.disabled=true;
  Promise.all([api("/mobile/computer"),api("/mobile/sessions")]).then(function(results) {
    if(!view.dialog.isConnected) return;
    var computer=results[0], data=results[1]; sessionDirectory=data; view.body.replaceChildren();
    view.body.appendChild(createButton("+ New session",function() { view.dialog.close(); renderNewSession(); },"computer-new"));
    view.body.appendChild(hubElement("h3","drawer-label","Computers"));
    var identity=hubElement("div","computer-identity");
    var icon=hubElement("span","computer-symbol"); icon.innerHTML=$("computer-menu").innerHTML;
    var label=hubElement("div"); label.append(hubElement("h3","",computer.name),hubElement("span","computer-online","Connected · " + (computer.platform==="win32" ? "Windows" : computer.platform==="darwin" ? "macOS" : "Linux")));
    identity.append(icon,label); view.body.appendChild(identity);
    view.body.appendChild(hubElement("p","muted","Your sessions run here. Keep this computer awake and GatedSpace open to continue from your phone."));
    view.body.appendChild(hubElement("p","computer-checked","Checked at " + new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})));
    view.body.appendChild(hubElement("h3","drawer-label","Open sessions"));
    orderedSessions(data).filter(function(s) { return s.live; }).forEach(function(s) {
      view.body.appendChild(directoryRow(s,function(session,button) { view.dialog.close(); openDirectorySession(session,button); }));
    });
    if(!data.sessions.length) view.body.appendChild(hubElement("p","muted","No sessions are open yet."));
    view.body.appendChild(hubElement("h3","drawer-label","Browser"));
    view.body.appendChild(hubElement("p","muted","Live browser viewing and taking control from your phone are not connected yet."));
  }).catch(function(e) { if(view.dialog.isConnected) { view.body.replaceChildren(hubElement("p","err",e.message),createButton("Try again",load,"drawer-row")); } }).finally(function() { refreshButton.disabled=false; });
  }
  load();
}
$("space-menu").onclick=openConversationMenu;
$("computer-menu").onclick=openComputers;
`;
