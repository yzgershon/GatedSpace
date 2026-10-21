import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, Check, ChevronDown, ChevronRight, Code2, Files, GitBranch, ListFilter, MessageSquare, Mic, PanelRight, Pause, Play, Plus, RotateCcw, SkipForward, Square, X } from 'lucide-react';
import { SessionComposerButtons } from '../../src/renderer/components/SessionComposerControls/SessionComposerButtons/SessionComposerButtons';
import { draculaTheme } from '../../src/shared/themes/built-in/dracula';
import codex from '../../../../packages/ui/src/assets/icons/preset-icons/codex.svg';
import claude from '../../../../packages/ui/src/assets/icons/preset-icons/claude.svg';
import { CodeSurface } from './CodeSurface';
import { contents, files, steps } from './sample';
import '../../src/renderer/globals.css';
import './style.css';

for(const [key,value] of Object.entries(draculaTheme.ui)) if(typeof value==='string') document.documentElement.style.setProperty(`--${key.replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`)}`,value);
document.documentElement.classList.add('dark');

function Preview(){
 const [coding,setCoding]=useState(true),[step,setStep]=useState(1),[playing,setPlaying]=useState(false),[typed,setTyped]=useState(0);
 const [selected,setSelected]=useState(0),[follow,setFollow]=useState(true),[diff,setDiff]=useState(false),[explorer,setExplorer]=useState(true);
 const [provider,setProvider]=useState('Codex'),[draft,setDraft]=useState(''),[messages,setMessages]=useState<string[]>([]),[asking,setAsking]=useState(false);
 const [effort,setEffort]=useState('xhigh'),[model,setModel]=useState('GPT-6 Astra'),[mode,setMode]=useState('auto'),[fast,setFast]=useState(false),[mic,setMic]=useState(false);
 const layout=useRef<HTMLDivElement>(null),drag=useRef(false),textarea=useRef<HTMLTextAreaElement>(null);
 const done=step===steps.length-1;
 const activity=steps[step];
 const before=contents(activity.file,step-1),target=contents(activity.file,step);
 const insertion=target.slice(before.length);
 const typing=typed<insertion.length&&!done;
 const shown=(index:number)=>index===activity.file&&typing?before+insertion.slice(0,typed):contents(index,step);
 const code=shown(selected),base=files[selected].base;
 const total=files.reduce((sum,_,index)=>sum+shown(index).split('\n').length-files[index].base.split('\n').length,0);
 const changedFiles=files.filter((file,index)=>shown(index)!==file.base).length;
 function goTo(next:number){setTyped(0);setStep(next);}
 useEffect(()=>{
  if(!playing||asking||done||!typing)return;
  const timer=setInterval(()=>setTyped(count=>Math.min(insertion.length,count+5)),24);
  return()=>clearInterval(timer);
 },[playing,asking,done,typing,insertion.length]);
 useEffect(()=>{
  if(!playing||asking||done||typing)return;
  const timer=setTimeout(()=>{setTyped(0);setStep(s=>Math.min(steps.length-1,s+1));},step===0||step===6?1100:650);
  return()=>clearTimeout(timer);
 },[playing,asking,done,typing,step]);
 useEffect(()=>{if(follow)setSelected(activity.file);},[activity.file,follow]);
 const status=asking?'Needs your reply':done?'Complete':playing?'Working':'Paused';
 const chooseFile=(index:number)=>{setSelected(index);setFollow(false);};
 const settings={provider,model,models:[{id:'GPT-6 Astra',name:'GPT-6 Astra'},{id:'Claude Opus',name:'Claude Opus'}],onModelChange:setModel,effort,efforts:['low','medium','high','xhigh'],onEffortChange:setEffort,mode,modes:[{id:'auto',label:'Auto',description:'Ask for approval when needed'},{id:'plan',label:'Plan',description:'Think through the approach first',kind:'plan' as const},{id:'full',label:'Full access',description:'Work without approval prompts',kind:'full' as const}],onModeChange:setMode,fast,onFastChange:setFast};
 function send(){if(!draft.trim())return;setMessages(m=>[...m,draft.trim()]);setDraft('');}
 return <div className="live-preview">
  <div className="demo-toolbar">
   <span><strong>Live code</strong><span className="demo-caption">Interactive preview · simulated edits</span></span>
   <div className="demo-actions">
    <button onClick={()=>{if(done)goTo(0);setAsking(false);setPlaying(!playing||done);}} aria-label={playing&&!done?'Pause demo':'Play demo'}>{playing&&!done?<Pause/>:<Play/>}<span>{playing&&!done?'Pause':'Play demo'}</span></button>
    <button aria-label="Next edit" title="Next edit" disabled={done} onClick={()=>{setPlaying(true);goTo(Math.min(steps.length-1,step+1));}}><SkipForward/></button>
    <button aria-label="Restart demo" title="Restart demo" onClick={()=>{goTo(0);setPlaying(false);setAsking(false);setFollow(true);}}><RotateCcw/></button>
    <select aria-label="Preview session state" value={asking?'question':done?'complete':'working'} onChange={e=>{setPlaying(false);setAsking(e.target.value==='question');if(e.target.value==='complete')goTo(steps.length-1);else if(done)goTo(1);}}><option value="working">Working</option><option value="question">Needs a reply</option><option value="complete">Complete</option></select>
   </div>
  </div>
  <div className="workspace-shell">
   <header className="workspace-top">
    <strong className="brand">GatedSpace</strong><span className="project-name"><ChevronRight/> superset</span>
    <button className="layout-toggle" aria-pressed={coding} onClick={()=>setCoding(!coding)}>{coding?<MessageSquare/>:<Code2/>}{coding?'Conversation':'Live code'}<span className="layout-hint">{coding?'Return to chat':'Watch edits'}</span></button>
   </header>
   <div ref={layout} className="live-layout" data-coding={coding}>
    {coding&&<section className="editor-panel" aria-label="Live code editor">
     <div className="editor-title"><button className="icon-button" aria-label="Toggle file list" aria-pressed={explorer} onClick={()=>setExplorer(!explorer)}><Files/></button><strong>Live editor</strong><span className="file-count">{changedFiles} changed</span><button className="follow-button" aria-pressed={follow} onClick={()=>setFollow(!follow)}><ListFilter/>{follow?'Following agent':'Follow changes'}</button></div>
     <div className="editor-workspace" data-explorer={explorer}>
      {explorer&&<nav className="file-explorer" aria-label="Changed files"><div className="folder-row"><ChevronDown/> src / components</div>{files.map((file,index)=><button key={file.name} aria-current={selected===index?'page':undefined} onClick={()=>chooseFile(index)} title={file.path}><span className={`file-glyph ${file.language}`}>{file.language==='css'?'#':'TS'}</span><span>{file.name}</span>{shown(index)!==file.base&&<small>M</small>}</button>)}<div className="explorer-note">Only files touched in this session appear here.</div></nav>}
      <div className="editor-document">
       <div className="code-tabs" role="tablist" aria-label="Open files">{files.map((file,index)=><button key={file.name} role="tab" aria-selected={index===selected} onClick={()=>chooseFile(index)} title={file.path}><span className={`file-glyph ${file.language}`}>{file.language==='css'?'#':'TS'}</span><span>{file.name}</span>{shown(index)!==file.base&&<small>M</small>}</button>)}</div>
       <div className="code-breadcrumb"><span>src <ChevronRight/> components <ChevronRight/> <strong>{files[selected].name}</strong></span><div className="view-switch"><button aria-pressed={!diff} onClick={()=>setDiff(false)}>Code</button><button aria-pressed={diff} onClick={()=>setDiff(true)}>Diff</button></div></div>
       <div className="editor-views" data-diff={diff}>
        {diff&&<section className="diff-side"><div className="diff-label">Before</div><CodeSurface code={base} language={files[selected].language} addedFrom={9999} follow={false} label="Original code"/></section>}
        <section className="diff-side">{diff&&<div className="diff-label">After <span>+{code.split('\n').length-base.split('\n').length}</span></div>}<CodeSurface code={code} language={files[selected].language} addedFrom={base.split('\n').length} follow={follow} caret={selected===activity.file&&typing} streaming={playing&&!asking&&typing} label="Current code"/></section>
       </div>
       <div className="editor-status"><span><GitBranch/> windows-port</span><span>{code.split('\n').length} lines</span><span>{files[selected].language==='css'?'CSS':'TypeScript React'}</span><span className="editor-write-state" data-writing={playing&&typing&&!asking}>{selected===activity.file&&typing?(playing&&!asking?'Typing live':'Typing paused'):'Read only'}</span></div>
      </div>
     </div>
    </section>}
    {coding&&<div className="session-divider" role="separator" aria-label="Resize conversation" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={520} aria-valuenow={360} tabIndex={0} onKeyDown={e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const el=layout.current;if(!el)return;const old=Number.parseFloat(getComputedStyle(el).getPropertyValue('--chat-width'))||360;const next=Math.max(260,Math.min(520,old+(e.key==='ArrowLeft'?20:-20)));el.style.setProperty('--chat-width',`${next}px`);e.currentTarget.setAttribute('aria-valuenow',String(next));}} onPointerDown={e=>{drag.current=true;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!drag.current||!layout.current)return;const width=Math.max(260,Math.min(520,layout.current.getBoundingClientRect().right-e.clientX));layout.current.style.setProperty('--chat-width',`${width}px`);e.currentTarget.setAttribute('aria-valuenow',String(Math.round(width)));}} onPointerUp={()=>{drag.current=false;}} onLostPointerCapture={()=>{drag.current=false;}}><span/></div>}
    <section className="live-session" aria-label="Agent conversation">
     <div className="session-heading"><img alt="" src={provider==='Codex'?codex:claude}/><div><strong>Polish session tabs</strong><span>Same session, same context</span></div><select aria-label="Preview agent" value={provider} onChange={e=>{setProvider(e.target.value);setModel(e.target.value==='Claude'?'Claude Opus':'GPT-6 Astra');}}><option>Codex</option><option>Claude</option></select></div>
     <div className="session-transcript">
      <div className="user-prompt">Make the session tabs compact, and keep the + button visible when there are lots of tabs.</div>
      <div className="assistant-message">I’ll keep the navigation controls fixed and let the tabs use the remaining space.</div>
      <div className="session-plan"><div><Check/> Inspect the current layout</div><div data-active={!done}><span className="plan-marker"/>{done?'Updated':'Update'} the tab strip</div><div className={step>=5?'':'future'}>{step>=5?<Check/>:<span className="plan-marker"/>} Cover the overflow case</div></div>
      <div className="activity-event"><Code2/><div><strong>{activity.label}</strong><p>{activity.detail}</p></div></div>
      {asking&&<div className="demo-question"><strong>Keep the conversation this wide?</strong><button onClick={()=>{setAsking(false);setPlaying(true);}}>Keep this width <Check/></button><button onClick={()=>{layout.current?.style.setProperty('--chat-width','440px');setAsking(false);setPlaying(true);}}>Give chat more space <PanelRight/></button></div>}
      {done&&<div className="completion"><Check/> Example changes are ready to review.</div>}
      {messages.map((message,index)=><div className="user-prompt" key={`${index}-${message}`}>{message}</div>)}
     </div>
     <div className="session-bottom">
      <div className="live-status" data-state={asking?'question':done?'complete':playing?'working':'paused'}><span className="status-indicator"/><span>{status}</span><span>{asking?'Waiting for you':done?'Demo complete':activity.label}</span></div>
      {changedFiles>0&&<button className="changed-pill" onClick={()=>{setCoding(true);setDiff(true);}}><Files/><strong>{changedFiles} {changedFiles===1?'file':'files'} changed</strong><span>+{total}</span></button>}
      <form className="session-composer" onSubmit={e=>{e.preventDefault();send();}}>
       <textarea ref={textarea} aria-label="Message draft" placeholder="Ask or steer the session…" value={draft} onChange={e=>setDraft(e.target.value)} spellCheck/>
       <div className="session-composer-toolbar"><button type="button" className="session-attach" title="Demo: add context" aria-label="Add context" onClick={()=>{setDraft(d=>d+' @SessionTabs.tsx');textarea.current?.focus();}}><Plus/></button><div className="spacer"/><SessionComposerButtons {...settings}/><button type="button" className="session-settings-icon session-flow-mic" data-recording={mic} aria-label={mic?'Stop simulated dictation':'Try simulated dictation'} title="Flow demo" onClick={()=>{setMic(!mic);if(mic)setDraft(d=>`${d}${d?' ':''}Keep the buttons compact.`);}}>{mic?<Square/>:<Mic/>}</button><button type="submit" className="session-send" aria-label="Send demo message" disabled={!draft.trim()}><ArrowUp/></button></div>
      </form>
      <div className="preview-footnote">{mic?'Flow demo is listening. Click the mic again.':'Preview only. Messages and edits stay in this demo.'}</div>
     </div>
    </section>
   </div>
  </div>
 </div>;
}
createRoot(document.getElementById('app')!).render(<Preview/>);
