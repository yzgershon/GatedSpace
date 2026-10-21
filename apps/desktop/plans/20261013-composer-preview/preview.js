/* Static design prototype: no provider calls, permission changes, or microphone access. */
const paths = {
  brain: '<path d="M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 3 10a4 4 0 0 0 .5 7.2A4 4 0 0 0 12 19a4 4 0 0 0 8.5-1.8A4 4 0 0 0 21 10a4 4 0 0 0-3.2-6A3 3 0 0 0 12 5"/><path d="M8 7c-2 0-3 2-2 4m12-4c2 0 3 2 2 4M7 15c2-1 3 0 3 2m7-2c-2-1-3 0-3 2"/>',
  permissions: '<path d="m12 2 8.5 5v10L12 22l-8.5-5V7z"/><path d="m8 9 2.5 3L8 15m5 0h3"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-3 0h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M12 20V4m-7 7 7-7 7 7"/>',
  stop: '<rect data-type="stop" x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-4 0h8"/>',
  expand: '<path d="M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7"/>',
  return: '<path d="M9 4H4v16h16v-5m-9-5h10m-10 0 4-4m-4 4 4 4"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6m-12 6h8m-4-4v8"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  message: '<path d="M21 11a9 9 0 0 1-9 9 11 11 0 0 1-4-.8L3 21l1.8-5a9 9 0 1 1 16.2-5Z"/>',
  edit: '<path d="m16 3 5 5L9 20l-6 1 1-6zM13 6l5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  queue: '<path d="M4 3v12a3 3 0 0 0 3 3h13m-4-4 4 4-4 4M8 4h12M8 9h8"/>',
};
function icon(name) { return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name] || paths.spark}</svg>`; }
for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
const $ = (id) => document.getElementById(id);
let expanded = false;
let queued = '';
let dictating = false;
let voiceDraft = '';
let voiceCaret = 0;
let demoTimer;
let toastTimer;
let activeState = 'working';
const states = {
  working: ['Working', 'Checking the composer layout', 'spark'],
  question: ['Needs your reply', 'A question is ready for you', 'message'],
  complete: ['Task complete', 'Changes are ready to review', 'check'],
  error: ['Needs attention', 'A check failed. Open the session for details.', 'message'],
  idle: ['Ready when you are', 'Your session is open', 'spark'],
};
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000); }
function updateSend() { const hasDraft = $('draft').value.trim().length > 0; const working = activeState === 'working'; const label = hasDraft ? (working ? 'Queue message' : 'Send message') : (working ? 'Stop demo task' : 'Send message'); $('send').setAttribute('aria-label', label); $('send').title = label; $('send').innerHTML = icon(!hasDraft && working ? 'stop' : 'arrow'); $('send').disabled = !hasDraft && !working; }
function setState(state, detail) { activeState = state; $('shell').dataset.state = state; $('state').value = state; const [label, description, symbol] = states[state]; $('activity-state').textContent = label; $('activity-detail').textContent = detail || description; $('inline-activity').textContent = detail || description; document.querySelector('.activity-agent').innerHTML = icon(symbol); $('pill-stop').hidden = state !== 'working'; $('question-card').hidden = state !== 'question'; if (state === 'question') { $('activity-details').hidden = true; $('activity-toggle').setAttribute('aria-expanded', 'false'); } updateSend(); }
function setView(value) { expanded = value; $('shell').classList.toggle('expanded', expanded); $('conversation').hidden = expanded; $('composer-dock').hidden = expanded; $('browser-preview').hidden = !expanded; $('activity-dock').hidden = !expanded; $('composer-view').setAttribute('aria-pressed', String(!expanded)); $('expanded-view').setAttribute('aria-pressed', String(expanded)); $('expand').setAttribute('aria-label', expanded ? 'Return to session' : 'Expand preview'); $('expand').title = expanded ? 'Return to session' : 'Expand preview'; $('expand').innerHTML = icon(expanded ? 'return' : 'expand'); }
function logMessage(message) { const row = document.createElement('p'); row.textContent = message; $('chat-log').append(row); }
function renderQueue() { $('queued-message').hidden = !queued; $('queued-text').textContent = queued; }
function stopDemo() { clearInterval(demoTimer); setState('idle', 'Task stopped. You can continue in the session.'); toast('Demo task stopped.'); }
function answer(value) { if (!value.trim()) return; clearInterval(demoTimer); logMessage(`You replied: ${value.trim()}`); $('custom-answer').hidden = true; $('answer-text').value = ''; setState('working', 'Continuing with your answer'); toast('Demo reply sent.'); }
$('composer-view').onclick = () => setView(false);
$('expanded-view').onclick = () => setView(true);
$('expand').onclick = () => setView(!expanded);
$('return-session').onclick = () => { setView(false); $('draft').focus(); };
$('state').onchange = (event) => { clearInterval(demoTimer); setState(event.target.value); };
$('provider').onchange = (event) => { $('shell').dataset.provider = event.target.value; };
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { $('activity-details').hidden = true; $('activity-toggle').setAttribute('aria-expanded', 'false'); } });
$('attach').onclick = () => $('files').click();
$('files').onchange = () => { $('attachment-label').textContent = Array.from($('files').files).map(file => file.name).join(' · '); $('attachment-label').hidden = !$('files').files.length; };
$('computer').onclick = () => toast('Computer control stays in the left tools. No permissions change in this preview.');
$('draft').oninput = () => { $('draft').style.height = 'auto'; $('draft').style.height = Math.min(156, $('draft').scrollHeight) + 'px'; updateSend(); };
$('draft').onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } };
$('composer').onsubmit = (event) => { event.preventDefault(); const text = $('draft').value.trim(); if (!text) { if (activeState === 'working') stopDemo(); return; } if (activeState === 'working') { if (queued) { toast('One queued message is shown in this concept. Edit or remove it first.'); return; } queued = text; renderQueue(); } else { logMessage(`You: ${text}`); setState('working', 'Reading your message'); } $('draft').value = ''; $('draft').dispatchEvent(new Event('input')); };
$('edit-queue').onclick = () => { if ($('draft').value.trim()) { toast('Your current draft is preserved. Send or clear it before editing this demo queue.'); return; } $('draft').value = queued; queued = ''; renderQueue(); $('draft').dispatchEvent(new Event('input')); $('draft').focus(); };
$('delete-queue').onclick = () => { queued = ''; renderQueue(); };
$('mic').onpointerdown = (event) => event.preventDefault();
$('mic').onclick = () => { dictating = !dictating; $('mic').setAttribute('aria-pressed', String(dictating)); $('mic').setAttribute('aria-label', dictating ? 'Finish Flow dictation demo' : 'Start Flow dictation demo'); $('voice-status').hidden = !dictating; if (dictating) { voiceDraft = $('draft').value; voiceCaret = $('draft').selectionStart ?? voiceDraft.length; toast('Flow listening demo. Click the mic again to insert sample text. No audio is recorded.'); } else { const words = 'Keep the composer compact and the controls easy to reach.'; const current = $('draft').value; if (current === voiceDraft) $('draft').value = voiceDraft.slice(0, voiceCaret) + words + voiceDraft.slice(voiceCaret); else $('draft').value = current + (current ? ' ' : '') + words; $('draft').dispatchEvent(new Event('input')); toast('Sample dictation inserted. Nothing was sent.'); } $('draft').focus(); };
$('activity-toggle').onclick = () => { if (activeState === 'question') { $('question-card').hidden = !$('question-card').hidden; return; } const open = $('activity-details').hidden; $('activity-details').hidden = !open; $('activity-toggle').setAttribute('aria-expanded', String(open)); };
$('pill-stop').onclick = stopDemo;
$('run-demo').onclick = () => { clearInterval(demoTimer); const steps = ['Reading the current composer', 'Adjusting control spacing', 'Checking question-card recovery', 'Running layout checks']; let index = 0; setState('working', steps[0]); demoTimer = setInterval(() => { index++; if (index >= steps.length) { clearInterval(demoTimer); setState('complete'); $('activity-events').innerHTML = steps.map(step => `<li>${icon('check')}<span>${step}</span></li>`).join(''); return; } setState('working', steps[index]); $('activity-events').replaceChildren(...steps.slice(0, index + 1).map((step, number) => { const item = document.createElement('li'); item.innerHTML = number === index ? '<span class="live-dot"></span>' : icon('check'); const label = document.createElement('span'); label.textContent = step; item.append(label); return item; })); }, 2200); };
for (const button of document.querySelectorAll('[data-answer]')) button.onclick = () => answer(button.dataset.answer);
$('other-answer').onclick = () => { $('custom-answer').hidden = false; $('answer-text').focus(); };
$('custom-answer').onsubmit = (event) => { event.preventDefault(); answer($('answer-text').value); };
$('dismiss-question').onclick = () => { setState('working', 'Question dismissed without sending an answer'); };
$('preview-theme').onclick = () => document.querySelector('.sample-page').classList.toggle('dark');
$('sample-action').onclick = () => { $('sample-feedback').textContent = 'New project clicked. The preview remains usable behind the activity pill.'; };
for (const card of document.querySelectorAll('.sample-card')) card.onclick = () => { $('sample-feedback').textContent = `${card.querySelector('strong').textContent} selected.`; };
setState('working');
