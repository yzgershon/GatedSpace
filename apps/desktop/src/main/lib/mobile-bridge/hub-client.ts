/** Topic organization, explicit task tracking and saved replies. No simulated agent work. */
export const MOBILE_HUB_CLIENT_JS = `
var hubData = null, channelFilter = null, taskFilter = "today", outputFilter = "all";
var lastChat = null, hubResumeRequests = {}, resolvedHubReferences = {};
function openHubSession(ref) {
  if(!ref.sessionId) { openNotifiedSession(ref.key,ref.provider); return; }
  var generation=viewGeneration;
  api("/mobile/sessions").then(function(data) {
    if(generation!==viewGeneration) return;
    var live=data.sessions.find(function(s) { return s.provider===ref.provider && s.sessionId===ref.sessionId; });
    if(live) { openSession(live.key,live.provider); return; }
    var identity=ref.provider+":"+ref.sessionId;
    if(!hubResumeRequests[identity]) hubResumeRequests[identity]=requestId();
    return api("/mobile/resume",{method:"POST",body:JSON.stringify({provider:ref.provider,sessionId:ref.sessionId,requestId:hubResumeRequests[identity]})})
      .then(function(session) { if(generation===viewGeneration) openSession(session.key,session.provider); });
  }).catch(function(e) { if(generation===viewGeneration) fail(e.message); });
}
function resolveHubReference() {
  if(!current || !sessionData || !sessionData.sessionId) return;
  var ref=sessionReference(), identity=ref.provider+":"+ref.key+":"+ref.sessionId;
  if(resolvedHubReferences[identity]) return;
  resolvedHubReferences[identity]=true;
  api("/mobile/hub/references",{method:"POST",body:JSON.stringify(ref)}).catch(function() { delete resolvedHubReferences[identity]; });
}
function hubElement(tag, className, text) {
  var node = document.createElement(tag); node.className = className || "";
  if (text != null) node.textContent = text; return node;
}
function animateMobileView(node,direction) {
  if(!node.animate || document.body.dataset.motion==="reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var targets=node===main ? Array.from(node.children).filter(function(child) { return getComputedStyle(child).position!=="fixed"; }) : [node];
  targets.forEach(function(target) { target.getAnimations().forEach(function(animation) { animation.cancel(); }); target.animate([{opacity:.5,transform:"translateX("+(direction===-1 ? -10 : 10)+"px)"},{opacity:1,transform:"translateX(0)"}],{duration:220,easing:"cubic-bezier(.2,.75,.2,1)"}); });
}
function loadHub() { return api("/mobile/hub").then(function(data) { hubData = data; return data; }); }
function hubRecordInput(record) {
  var data = Object.assign({}, record); delete data.version; delete data.createdAt; delete data.updatedAt; delete data.excerpt; delete data.html; return data;
}
function saveHub(kind, record, changes) {
  return api("/mobile/hub/" + kind + "/" + encodeURIComponent(record.id), {
    method:"PATCH", body:JSON.stringify(Object.assign(hubRecordInput(record), changes, {expectedVersion:record.version}))
  });
}
function hubDialog(label, style) {
  var dialog = document.createElement("dialog"); dialog.className = "hub-dialog " + (style || "");
  var bar = hubElement("div", "dialog-bar");
  var heading = hubElement("h2", "", label); heading.id = "dialog-" + requestId(); dialog.setAttribute("aria-labelledby", heading.id);
  bar.append(heading, createButton("×", function() { dialog.close(); }, "close-dialog"));
  bar.lastChild.setAttribute("aria-label", "Close " + label); dialog.appendChild(bar);
  var body = hubElement("div", "dialog-body"); dialog.appendChild(body);
  dialog.addEventListener("click", function(e) { if(e.target === dialog) { var rect = dialog.getBoundingClientRect(); if(e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
  dialog.onclose = function() { dialog.remove(); };
  document.body.appendChild(dialog); dialog.showModal(); return {dialog:dialog, body:body};
}
function hubField(parent, label, value, multiline) {
  var wrap = hubElement("label", "hub-field", label);
  var field = document.createElement(multiline ? "textarea" : "input"); field.value = value || "";
  field.maxLength = multiline ? 10000 : 160; if(multiline) field.rows = 4;
  wrap.appendChild(field); parent.appendChild(wrap); return field;
}
function hubChannelPicker(parent, value) {
  var wrap = hubElement("label", "hub-field", "Channel"), select = document.createElement("select");
  var option = document.createElement("option"); option.value = ""; option.textContent = "Everything"; select.appendChild(option);
  ((hubData && hubData.channels) || []).filter(function(c) { return !c.archived; }).forEach(function(c) {
    var item = document.createElement("option"); item.value = c.id; item.textContent = c.title; select.appendChild(item);
  }); select.value = value || ""; wrap.appendChild(select); parent.appendChild(wrap); return select;
}
function hubError(parent, error) { var node = parent.querySelector(".hub-error"); if(!node) { node = hubElement("p", "hub-error err"); node.setAttribute("role","alert"); parent.appendChild(node); } node.textContent = error.message; }
function hubEmpty(parent, titleText, description, actionText, action) {
  var empty = hubElement("section", "hub-empty"); empty.append(hubElement("div", "empty-mark", "✦"), hubElement("h2", "", titleText), hubElement("p", "muted", description));
  if(action) empty.appendChild(createButton(actionText, action, "primary")); parent.appendChild(empty);
}
function hubHeading(label, description, action, onAction) {
  var heading = hubElement("div", "hub-heading"); heading.append(hubElement("h2", "", label), hubElement("p", "muted", description));
  if(onAction) heading.appendChild(createButton(action, onAction, "heading-action")); main.appendChild(heading);
}
function selectedChannel() { return hubData && hubData.channels.find(function(c) { return c.id === channelFilter && !c.archived; }); }
function channelMatches(session) {
  var channel = selectedChannel(); if(!channel) return true;
  return channel.sessions.some(function(s) { return s.provider === session.provider && (s.key === session.key || (s.sessionId && s.sessionId === session.sessionId)); });
}
function sessionReference() { return {provider:currentProvider, key:current, sessionId:sessionData && sessionData.sessionId || undefined}; }
function rememberChat() { if(current) lastChat = sessionReference(); }
function openHubChat() {
  if(lastChat) openHubSession(lastChat); else setTab("sessions");
}
function newChannel() {
  var view = hubDialog("New channel"), field = hubField(view.body, "Name", "", false), id = requestId();
  view.body.appendChild(hubElement("p","muted","Keep related conversations and work together."));
  var button = createButton("Create channel", function() {
    if(!field.value.trim()) { field.focus(); return; } button.disabled = true;
    api("/mobile/hub/channels", {method:"POST",body:JSON.stringify({id:id,title:field.value.trim()})}).then(function(channel) {
      channelFilter = channel.id; return loadHub();
    }).then(function() { view.dialog.close(); setTab("sessions"); }).catch(function(e) { hubError(view.body,e); }).finally(function() { button.disabled = false; });
  }, "primary"); view.body.appendChild(button); field.focus();
}
function chooseChannelForSession() {
  var ref = sessionReference(), view = hubDialog("Add conversation to a channel");
  loadHub().then(function(data) {
    if(!view.dialog.isConnected) return;
    var available = data.channels.filter(function(c) { return !c.archived; });
    if(!available.length) { view.body.appendChild(hubElement("p","muted","Create a channel from the menu first.")); return; }
    available.forEach(function(channel) {
      var button = createButton(channel.title, function() {
        button.disabled = true;
        var sessions = channel.sessions.filter(function(s) { return !(s.provider === ref.provider && s.key === ref.key); }); sessions.push(ref);
        saveHub("channels",channel,{sessions:sessions}).then(function() { view.dialog.close(); showHint("Conversation added to " + channel.title + ".",false); }).catch(function(e) { hubError(view.body,e); button.disabled = false; });
      },"drawer-row"); view.body.appendChild(button);
    });
  }).catch(function(e) { hubError(view.body,e); });
}
function openHubMenu() {
  var view = hubDialog("Your space", "channel-drawer");
  view.body.appendChild(createButton("Everything",function() { channelFilter=null; view.dialog.close(); setTab("sessions"); },"drawer-row"));
  view.body.appendChild(hubElement("h3","drawer-label","Channels"));
  var list = hubElement("div", "", "Loading…"); view.body.appendChild(list);
  view.body.appendChild(createButton("+ New channel",function() { view.dialog.close(); newChannel(); },"drawer-row"));
  loadHub().then(function(data) {
    if(!view.dialog.isConnected) return; list.replaceChildren();
    data.channels.filter(function(c) { return !c.archived; }).forEach(function(channel) {
      list.appendChild(createButton(channel.title,function() { channelFilter=channel.id; view.dialog.close(); setTab("sessions"); },"drawer-row"));
    });
    if(!list.children.length) list.appendChild(hubElement("p","muted","Make room for a project, a class, or an idea."));
  }).catch(function(e) { list.textContent = e.message; });
}
function openHubProfile() {
  openMobileSettings();
}
function editTask(task, session) {
  var view = hubDialog(task ? "Edit task" : "New task"), name = hubField(view.body,"What needs doing?",task && task.title,false);
  var notes = hubField(view.body,"Details",task && task.notes,true), channel = hubChannelPicker(view.body,task ? task.channelId : channelFilter), id = task ? task.id : requestId();
  view.body.appendChild(hubElement("p","muted",session || task && task.session ? "Linked to this conversation. Saving a task does not send a prompt." : "Save the task, then open a conversation when you are ready to work on it."));
  var button = createButton("Save task",function() {
    if(!name.value.trim()) { name.focus(); return; } button.disabled = true;
    var data = {id:id,title:name.value.trim(),notes:notes.value,channelId:channel.value || null,session:session || task && task.session || null,done:!!(task && task.done),archived:!!(task && task.archived)};
    var request = task ? saveHub("tasks",task,data) : api("/mobile/hub/tasks",{method:"POST",body:JSON.stringify(data)});
    request.then(function() { view.dialog.close(); setTab("tasks"); }).catch(function(e) { hubError(view.body,e); }).finally(function() { button.disabled = false; });
  },"primary"); view.body.appendChild(button); name.focus();
}
function openTask(task) {
  var view = hubDialog(task.title), description = hubElement("p","task-notes",task.notes || "No extra details."); view.body.appendChild(description);
  view.body.appendChild(hubElement("p","muted",task.done ? "Completed" : "Open task"));
  if(task.session) view.body.appendChild(createButton("Open conversation",function() { view.dialog.close(); openHubSession(task.session); },"primary"));
  else view.body.appendChild(createButton("Start a conversation",function() { view.dialog.close(); renderNewSession({task:task}); },"primary"));
  view.body.appendChild(createButton("Edit task",function() { view.dialog.close(); editTask(task); },"drawer-row"));
  var done = createButton(task.done ? "Reopen task" : "Mark complete",function() {
    done.disabled=true; saveHub("tasks",task,{done:!task.done}).then(function() { view.dialog.close(); setTab("tasks"); }).catch(function(e) { hubError(view.body,e); done.disabled=false; });
  },"drawer-row"); view.body.appendChild(done);
  var archive = createButton(task.archived ? "Restore task" : "Archive task",function() {
    archive.disabled=true; saveHub("tasks",task,{archived:!task.archived}).then(function() { view.dialog.close(); setTab("tasks"); }).catch(function(e) { hubError(view.body,e); archive.disabled=false; });
  },"drawer-row"); view.body.appendChild(archive);
}
function hubFilters(parent, values, selected, choose) {
  var bar = hubElement("div","hub-filters"); values.forEach(function(pair) {
    var button = createButton(pair[1],function() { choose(pair[0]); }); button.setAttribute("aria-pressed",String(selected===pair[0])); bar.appendChild(button);
  }); parent.appendChild(bar);
}
function renderTasks() {
  var generation=viewGeneration; title.textContent="Tasks"; main.replaceChildren();
  var tools=hubElement("div","task-toolbar"); main.appendChild(tools);
  hubFilters(tools,[["today","Today"],["all","All"]],taskFilter,function(value) { taskFilter=value; setTab("tasks"); });
  var status=document.createElement("select"); status.setAttribute("aria-label","Task status");
  [["view","Status"],["done","Completed"],["archived","Archived"]].forEach(function(pair) { var option=document.createElement("option"); option.value=pair[0]; option.textContent=pair[1]; status.appendChild(option); });
  status.value=taskFilter==="done" || taskFilter==="archived" ? taskFilter : "view"; status.onchange=function() { taskFilter=status.value==="view" ? "today" : status.value; setTab("tasks"); }; tools.appendChild(status);
  var search=document.createElement("input"); search.type="search"; search.placeholder="Search tasks"; search.setAttribute("aria-label","Search tasks"); main.appendChild(search);
  var list=hubElement("div","task-list","Loading tasks…"); main.appendChild(list);
  var form=hubElement("form","quick-task"), field=document.createElement("input"); field.placeholder="Add a task…"; field.setAttribute("aria-label","Add a task"); field.maxLength=160;
  var add=createButton("+",function() { if(field.value.trim()) form.requestSubmit(); else editTask(); },"quick-task-add"); add.type="button"; add.setAttribute("aria-label","+ New task"); form.append(field,add); main.appendChild(form);
  var quickId=requestId(); form.onsubmit=function(e) {
    e.preventDefault(); if(!field.value.trim() || field.disabled) return; field.disabled=true; add.disabled=true;
    api("/mobile/hub/tasks",{method:"POST",body:JSON.stringify({id:quickId,title:field.value.trim(),notes:"",channelId:channelFilter,session:null,done:false,archived:false})})
      .then(function() { if(generation===viewGeneration) { taskFilter="today"; setTab("tasks"); } }).catch(function(e) { hubError(form,e); field.disabled=false; add.disabled=false; });
  };
  var loaded=null;
  function draw() {
    if(!loaded) return;
    if(generation!==viewGeneration) return; list.replaceChildren();
    var today=new Date().toDateString();
    var tasks=loaded.tasks.filter(function(t) { return (!channelFilter || t.channelId===channelFilter) && (t.title+" "+t.notes).toLowerCase().includes(search.value.toLowerCase()) && (taskFilter==="archived" ? t.archived : !t.archived && (taskFilter==="all" || (taskFilter==="done" ? t.done : !t.done && new Date(t.updatedAt).toDateString()===today))); }).sort(function(a,b) { return b.updatedAt-a.updatedAt; });
    tasks.forEach(function(task) {
      var row=createButton("",function() { openTask(task); },"task-row"), mark=hubElement("span","task-mark",task.done ? "✓" : "");
      row.dataset.done=String(task.done);
      var body=hubElement("span","task-body"); body.append(hubElement("strong","",task.title),hubElement("span","muted",task.done ? "Completed" : task.session ? (task.session.provider==="codex" ? "Codex" : "Claude") + " · " + (task.notes || "Open conversation") : task.notes || "Ready when you are")); row.append(mark,body,hubElement("span","task-time",relTime(task.updatedAt))); list.appendChild(row);
    });
    if(!tasks.length) hubEmpty(list,search.value ? "No matching tasks" : "Space for what's next",taskFilter==="today" ? "Add a task, or choose All to see earlier work." : "Your saved tasks will appear here.");
  }
  search.oninput=draw;
  loadHub().then(function(data) { loaded=data; draw(); }).catch(function(e) { if(generation===viewGeneration) { list.textContent=e.message; list.appendChild(createButton("Try again",function() { setTab("tasks"); })); } });
}
function saveReply(item) {
  var ref=sessionReference(), view=hubDialog("Save to Make"), name=hubField(view.body,"Title",item.text.split(/\\n/)[0].replace(/^#+\\s*/,"").slice(0,120),false), id=requestId();
  var channel=hubChannelPicker(view.body,channelFilter);
  view.body.appendChild(hubElement("p","muted","Save this reply so you can find it again without scrolling through the conversation."));
  var button=createButton("Save reply",function() {
    if(!name.value.trim()) { name.focus(); return; } button.disabled=true;
    api("/mobile/hub/outputs",{method:"POST",body:JSON.stringify({id:id,title:name.value.trim(),body:item.text,channelId:channel.value || null,source:Object.assign({},ref,{messageId:item.id})})})
      .then(function() { view.dialog.close(); showHint("Saved to Make.",false); }).catch(function(e) { hubError(view.body,e); }).finally(function() { button.disabled=false; });
  },"primary"); view.body.appendChild(button);
}
function chooseReplyToSave() {
  var view=hubDialog("Save a reply","reply-picker"), replies=new Map();
  historyMessages.concat(sessionData && sessionData.messages || []).forEach(function(item) { if(item.kind==="assistant" && item.text) replies.set(item.id,item); });
  Array.from(replies.values()).reverse().forEach(function(item) {
    view.body.appendChild(createButton(item.text.slice(0,160),function() { view.dialog.close(); saveReply(item); },"drawer-row reply-choice"));
  });
  if(!replies.size) view.body.appendChild(hubElement("p","muted","This conversation has no replies to save yet."));
}
function openOutput(item) {
  var view=hubDialog(item.title,"output-sheet"); view.body.textContent="Loading saved reply…";
  api("/mobile/hub/outputs/"+encodeURIComponent(item.id)).then(function(output) {
    if(!view.dialog.isConnected) return; view.body.replaceChildren();
    var content=hubElement("article","markdown saved-output"); content.innerHTML=output.html; view.body.appendChild(content);
    var actions=hubElement("div","output-actions");
    actions.appendChild(createButton("Download Markdown",function() {
      var url=URL.createObjectURL(new Blob([output.body],{type:"text/markdown;charset=utf-8"})), link=document.createElement("a"); link.href=url; link.download=output.title.replace(/[^a-z0-9 _-]/gi,"").slice(0,100) + ".md"; link.click(); setTimeout(function() { URL.revokeObjectURL(url); },30000);
    }));
    if(output.source) actions.appendChild(createButton("Open conversation",function() { view.dialog.close(); openHubSession(output.source); }));
    var archive=createButton(output.archived ? "Restore" : "Archive",function() {
      archive.disabled=true; saveHub("outputs",output,{archived:!output.archived}).then(function() { view.dialog.close(); setTab("make"); }).catch(function(e) { hubError(view.body,e); archive.disabled=false; });
    }); actions.appendChild(archive); view.body.appendChild(actions);
  }).catch(function(e) { if(view.dialog.isConnected) view.body.textContent=e.message; });
}
function renderMake() {
  var generation=viewGeneration; title.textContent="Make"; main.replaceChildren();
  var feature=hubElement("section","make-feature"), illustration=hubElement("div","make-document"); illustration.setAttribute("aria-hidden","true");
  illustration.append(hubElement("span","","An idea, made real."),hubElement("i"),hubElement("i"),hubElement("i"));
  feature.append(illustration,hubElement("h2","","What would you like to make?"),createButton("Start creating ↗",function() { renderNewSession(); },"make-start")); main.appendChild(feature);
  main.appendChild(hubElement("h2","make-section-title","Templates"));
  var templates=hubElement("div","make-templates");
  [["Study guide","Turn a topic into clear notes.","Help me create a study guide. First ask what subject and material it should cover."],["Project brief","A clear plan for your next idea.","Help me write a project brief. First ask about the idea, its audience and the outcome I want."]].forEach(function(t) {
    var card=createButton("",function() { renderNewSession({prompt:t[2]}); },"template-card"); card.append(hubElement("span","template-symbol","+"),hubElement("strong","",t[0]),hubElement("span","muted",t[1])); templates.appendChild(card);
  }); main.appendChild(templates);
  main.appendChild(hubElement("h2","make-section-title","Saved work"));
  var search=document.createElement("input"); search.type="search"; search.placeholder="Find something you saved"; search.setAttribute("aria-label","Search saved work"); main.appendChild(search);
  hubFilters(main,[["all","All"],["archived","Archived"]],outputFilter,function(value) { outputFilter=value; setTab("make"); });
  var list=hubElement("div","output-grid","Loading saved work…"), loaded=[]; main.appendChild(list);
  function draw() {
    list.replaceChildren(); var items=loaded.filter(function(o) { return o.archived===(outputFilter==="archived") && (!channelFilter || o.channelId===channelFilter) && (o.title+" "+o.excerpt).toLowerCase().includes(search.value.toLowerCase()); });
    items.sort(function(a,b) { return b.updatedAt-a.updatedAt; }).forEach(function(item) {
      var card=createButton("",function() { openOutput(item); },"output-card");
      card.append(hubElement("h3","",item.title),hubElement("span","output-type","▤  " + relTime(item.updatedAt)),hubElement("p","output-excerpt",item.excerpt)); list.appendChild(card);
    });
    if(!items.length) hubEmpty(list,search.value ? "No matching work" : "Give your best replies a home",search.value ? "Try a different word or title." : "In a conversation, open the menu and choose Save a reply to Make.","Open conversations",function() { setTab("sessions"); });
  }
  search.oninput=draw; loadHub().then(function(data) { if(generation===viewGeneration) { loaded=data.outputs; draw(); } }).catch(function(e) { if(generation===viewGeneration) { list.textContent=e.message; list.appendChild(createButton("Try again",function() { setTab("make"); })); } });
}
$("space-menu").onclick=openHubMenu;
$("profile-menu").onclick=openHubProfile;
`;
