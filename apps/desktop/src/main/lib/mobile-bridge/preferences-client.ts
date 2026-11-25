/** Device preferences only. Provider/cloud settings are never simulated as connected. */
export const MOBILE_PREFERENCES_CLIENT_JS = `
var mobilePreferences={motion:"system",width:"medium",size:"standard",name:"",avatar:""};
try { mobilePreferences=Object.assign(mobilePreferences,JSON.parse(localStorage.getItem("gatedduet-preferences") || "{}")); } catch(_) {}
function applyMobilePreferences() {
  document.body.dataset.motion=mobilePreferences.motion==="reduced" ? "reduced" : "system";
  document.documentElement.style.setProperty("--transcript-width",({narrow:620,medium:760,wide:980}[mobilePreferences.width] || 760)+"px");
  document.documentElement.style.setProperty("--message-size",({small:14,standard:15,large:17}[mobilePreferences.size] || 15)+"px");
  var avatar=$("profile-menu").querySelector(".profile-photo");
  if(avatar) avatar.remove();
  var source=mobilePreferences.avatar;
  if(typeof source==="string" && /^data:image\\/(png|jpeg|webp);base64,/.test(source) && source.length<150000) {
    var image=document.createElement("img"); image.className="profile-photo"; image.alt=""; image.src=source;
    $("profile-menu").prepend(image); $("profile-menu").querySelector("svg").style.display="none";
  } else $("profile-menu").querySelector("svg").style.display="";
}
function saveMobilePreference(key,value) {
  var next=Object.assign({},mobilePreferences); next[key]=value;
  try { localStorage.setItem("gatedduet-preferences",JSON.stringify(next)); mobilePreferences=next; applyMobilePreferences(); return true; }
  catch(_) { fail("This browser could not save your preference. Free some storage and try again."); return false; }
}
function preferenceRow(parent,label,description) {
  var row=hubElement("div","preference-row"), text=hubElement("div","preference-copy");
  text.appendChild(hubElement("strong","",label)); if(description) text.appendChild(hubElement("p","muted",description));
  var control=hubElement("div","preference-control"); row.append(text,control); parent.appendChild(row); return control;
}
function preferenceChoices(parent,label,description,key,choices) {
  var control=preferenceRow(parent,label,description), group=hubElement("div","preference-segment");
  group.setAttribute("role","group"); group.setAttribute("aria-label",label);
  choices.forEach(function(choice) {
    var button=createButton(choice[1],function() { if(saveMobilePreference(key,choice[0])) { group.querySelectorAll("button").forEach(function(b) { b.setAttribute("aria-pressed",String(b===button)); }); } });
    button.setAttribute("aria-pressed",String(mobilePreferences[key]===choice[0])); group.appendChild(button);
  }); control.appendChild(group);
}
function renderMobileNotifications(parent) {
  var control=preferenceRow(parent,"Notifications","Replies and requests that need your attention."), status=hubElement("p","muted"); parent.appendChild(status);
  if(!("serviceWorker" in navigator) || !("PushManager" in window)) { status.textContent="This browser can't do push notifications."; return; }
  if(!window.isSecureContext) { status.textContent="Needs the HTTPS link. Switch the bridge to Tailscale HTTPS on the desktop."; return; }
  if(Notification.permission==="denied") { status.textContent="Blocked. Turn notifications back on for this app in your phone's settings."; return; }
  var button=createButton(pushReady ? "Turn off" : "Turn on notifications",function() {
    button.disabled=true;
    var action=pushReady ? navigator.serviceWorker.ready.then(function(reg) { return reg.pushManager.getSubscription(); }).then(function(sub) {
      if(!sub) return; return api("/push/unsubscribe",{method:"POST",body:JSON.stringify({endpoint:sub.endpoint})}).then(function() { return sub.unsubscribe(); });
    }).then(function() { localStorage.setItem("gatedduet-push-off","true"); pushReady=false; }) : enablePush().then(function() { localStorage.removeItem("gatedduet-push-off"); });
    action.then(function() { button.textContent=pushReady ? "Turn off" : "Turn on notifications"; status.textContent=pushReady ? "On for this phone." : "Off for this phone."; button.disabled=false; }).catch(function(e) { status.textContent=e.message; button.disabled=false; });
  },"setting-action"); control.appendChild(button);
  status.textContent=pushReady ? "On for this phone." : "Off for this phone.";
  if(isIos() && !window.matchMedia("(display-mode: standalone)").matches) parent.appendChild(hubElement("p","muted","On iPhone, use Share, then Add to Home Screen, and open the app from there to enable notifications."));
}
function renderSettings() {
  title.textContent="Settings"; main.replaceChildren();
  main.appendChild(createButton("Open settings",openMobileSettings,"drawer-row")); openMobileSettings();
}
function settingsGroup(parent,label) {
  var section=hubElement("section","settings-group");
  section.appendChild(hubElement("h3","settings-label",label));
  var rows=hubElement("div","settings-group-rows"); section.appendChild(rows); parent.appendChild(section); return rows;
}
function settingsLink(parent,label,value,action,icon) {
  var row=createButton("",action,"settings-link");
  var mark=hubElement("span","settings-icon"); mark.setAttribute("aria-hidden","true");
  var paths={account:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',usage:'<path d="M4 19a10 10 0 1 1 16 0M12 5v7l4 3"/>',appearance:'<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>',connections:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17 14v7m-3-3h7"/>',plugins:'<path d="m9 3 2 5m6-5-2 5M7 8h10v4a5 5 0 0 1-10 0zM12 17v5"/>',rules:'<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3"/>',voice:'<path d="M4 10v4m4-9v14m4-17v20m4-17v14m4-9v4"/>',network:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/>',about:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'};
  mark.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+(paths[icon] || paths.about)+'</svg>';
  row.append(mark,hubElement("span","settings-link-label",label));
  if(value) row.appendChild(hubElement("span","settings-value",value));
  row.appendChild(hubElement("span","settings-chevron","›")); parent.appendChild(row); return row;
}
function openMobileSettings() {
  var existing=document.querySelector(".settings-sheet"); if(existing) { existing.focus(); return; }
  var view=hubDialog("Settings","settings-sheet"), bar=view.dialog.querySelector(".dialog-bar"), heading=bar.querySelector("h2"), done=bar.querySelector("button");
  done.textContent="Done"; done.classList.add("sheet-done"); done.setAttribute("aria-label","Done");
  var backButton=createButton("‹",overview,"sheet-back"); backButton.setAttribute("aria-label","Back to settings"); backButton.hidden=true; bar.prepend(backButton);
  function section(key,label) {
    view.body.replaceChildren(); heading.textContent=label; backButton.hidden=false; view.dialog.scrollTop=0;
    var content=hubElement("section","settings-content"); view.body.appendChild(content); renderSettingsContent(content,key); animateMobileView(view.body,1);
  }
  function overview() {
    view.body.replaceChildren(); heading.textContent="Settings"; backButton.hidden=true; view.dialog.scrollTop=0;
    var accounts=settingsGroup(view.body,"Account");
    var profile=settingsLink(accounts,mobilePreferences.name || "Your profile","",function() { section("account","Account"); },"account");
    var picture=$("profile-menu").querySelector("img,svg");
    if(picture) { var avatar=picture.cloneNode(true); avatar.classList.add("settings-avatar"); profile.firstChild.replaceChildren(avatar); }
    settingsLink(accounts,"Usage","",function() { view.dialog.close(); setTab("usage"); },"usage");
    var tools=settingsGroup(view.body,"Your workspace");
    [["connections","Connections"],["plugins","Plugins"],["rules","Rules"]].forEach(function(pair) { settingsLink(tools,pair[1],"",function() { section(pair[0],pair[1]); },pair[0]); });
    var appearance=settingsGroup(view.body,"Appearance");
    settingsLink(appearance,"Themes",(currentTheme() || {}).name || "",function() { section("themes","Themes"); },"appearance");
    settingsLink(appearance,"Display and motion","",function() { section("general","Display and motion"); },"appearance");
    var notifications=settingsGroup(view.body,"Notifications"); renderMobileNotifications(notifications);
    var voice=settingsGroup(view.body,"Voice"); settingsLink(voice,"Voice and read aloud","Coming later",function() { section("voice","Voice"); },"voice");
    var privacy=settingsGroup(view.body,"Privacy and connection"); settingsLink(privacy,"Network access","",function() { section("network","Network access"); },"network");
    var about=settingsGroup(view.body,"About"); settingsLink(about,"About GatedDuet",$("ver").textContent,function() { section("about","About GatedDuet"); },"about");
    animateMobileView(view.body,-1);
  }
  overview();
}
function renderSettingsContent(content,section) {
  if(section==="themes") {
    renderThemePicker(content);
  } else if(section==="general") {
    preferenceChoices(content,"Transcript width","Applies when your screen has room.","width",[["narrow","Narrow"],["medium","Medium"],["wide","Wide"]]);
    preferenceChoices(content,"Text size","Conversation text and replies.","size",[["small","Small"],["standard","Standard"],["large","Large"]]);
    preferenceChoices(content,"Motion","Follow your device, or keep animations still.","motion",[["system","System"],["reduced","Reduced"]]);
  } else if(section==="account") {
    content.appendChild(hubElement("h3","settings-label","Your profile on this phone"));
    var name=hubField(content,"Display name",mobilePreferences.name,false); name.maxLength=80; name.onchange=function() { saveMobilePreference("name",name.value.trim()); };
    var control=preferenceRow(content,"Profile picture","Stored on this phone."), picker=document.createElement("input"); picker.type="file"; picker.accept="image/*"; picker.hidden=true;
    var choose=createButton("Choose photo",function() { picker.click(); },"setting-action"); control.append(choose,picker);
    picker.onchange=function() {
      var file=picker.files && picker.files[0]; if(!file) return;
      choose.disabled=true;
      readImage(file).then(function(photo) { if(saveMobilePreference("avatar",photo.thumbnail)) showHint("Profile picture updated.",false); }).catch(function(e) { fail(e.message); }).finally(function() { picker.value=""; choose.disabled=false; });
    };
    control.appendChild(createButton("Remove",function() { saveMobilePreference("avatar",""); },"setting-action"));
    content.appendChild(hubElement("h3","settings-label","Claude accounts")); var accounts=hubElement("div","muted","Loading…"); content.appendChild(accounts); renderAccounts(accounts);
    content.appendChild(hubElement("p","settings-note","Codex uses the account already connected to its desktop session. Browser sign-in and account management stay in GatedSpace on your computer."));
  } else if(section==="network") {
    renderConnection(content);
  } else if(section==="connections") {
    content.appendChild(createButton("Connected computer",openComputers,"drawer-row"));
    content.appendChild(hubElement("p","settings-note","Your Claude and Codex sessions use the connections configured on your computer. A mobile connector directory and browser sign-in handoff are still being built."));
  } else if(section==="voice") {
    content.appendChild(hubElement("p","settings-note","Voice conversations, voice selection, playback speed and reading replies aloud are not connected yet. For now, use your phone keyboard’s microphone to dictate a message."));
  } else if(section==="about") {
    content.appendChild(hubElement("h3","settings-label","GatedDuet"));
    content.appendChild(hubElement("p","settings-note","Your GatedSpace conversations, tasks and saved work, together on your phone."));
    content.appendChild(hubElement("p","app-version",$("ver").textContent));
    content.appendChild(hubElement("p","settings-note","Your connected computer runs the agents and stores your conversations. Private cloud execution and scheduled tasks are not enabled. Keep your computer awake and GatedSpace open."));
  } else if(section==="plugins") {
    content.appendChild(hubElement("h3","settings-label","Agent tools"));
    content.appendChild(hubElement("p","settings-note","Existing agent tools remain available in their sessions. Installing and managing plugins from GatedDuet is not connected yet."));
  } else {
    content.appendChild(hubElement("h3","settings-label","Instructions and permissions"));
    content.appendChild(hubElement("p","settings-note","Sessions keep their desktop instructions and permissions. Mobile messages never approve a pending tool action. Shared rules and writing preferences will be available here once they can be applied to the agents."));
  }
}
function renderThemePicker(content) {
  var grid=hubElement("div","theme-grid"); grid.setAttribute("aria-label","Themes"); content.appendChild(grid);
  function draw() {
    if(!content.isConnected) return; grid.replaceChildren();
    themes.forEach(function(theme) {
      var card=createButton("",function() {
        try { localStorage.setItem("gs-theme",theme.id); } catch(_) { hubError(content,new Error("Could not save the theme on this phone.")); return; }
        themeId=theme.id; applyTheme(theme); draw();
      },"theme-card"); card.setAttribute("aria-label",theme.name); card.setAttribute("aria-pressed",String((currentTheme() || {}).id===theme.id));
      var preview=hubElement("span","theme-preview"); preview.style.background=theme.ui.background; preview.style.setProperty("--theme-surface",theme.ui.card); preview.style.setProperty("--theme-accent",theme.ui.primary);
      preview.setAttribute("aria-hidden","true"); preview.append(hubElement("i","theme-preview-top"),hubElement("i","theme-preview-user"),hubElement("i","theme-preview-reply"));
      card.append(preview,hubElement("span","theme-name",theme.name)); grid.appendChild(card);
    });
  }
  if(themes.length) draw();
  else { grid.textContent="Loading themes…"; api("/themes").then(function(data) { themes=data.themes || []; draw(); }).catch(function(e) { if(content.isConnected) { grid.textContent=e.message; grid.appendChild(createButton("Try again",function() { content.replaceChildren(); renderThemePicker(content); })); } }); }
}
applyMobilePreferences();
`;
