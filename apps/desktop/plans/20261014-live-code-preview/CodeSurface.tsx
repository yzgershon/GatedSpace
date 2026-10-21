import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { bracketMatching, foldGutter, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { tags } from '@lezer/highlight';
const changed = StateEffect.define<number>();
const writing = StateEffect.define<boolean>();
class WritingCaret extends WidgetType {
 toDOM(){const caret=document.createElement('span');caret.className='live-code-caret';caret.setAttribute('aria-hidden','true');return caret;}
}
const caretField=StateField.define({
 create:()=>Decoration.none,
 update(value,tr){
  value=value.map(tr.changes);
  for(const effect of tr.effects) if(effect.is(writing)) value=effect.value?Decoration.set([
   Decoration.line({class:'live-code-writing-line'}).range(tr.state.doc.lineAt(tr.state.doc.length).from),
   Decoration.widget({widget:new WritingCaret(),side:1}).range(tr.state.doc.length)
  ]):Decoration.none;
  return value;
 },provide:field=>EditorView.decorations.from(field)
});
const lines = StateField.define({
 create:()=>Decoration.none,
 update(value,tr){
  value=value.map(tr.changes);
  for(const effect of tr.effects) if(effect.is(changed)) {
   const ranges=[];
   for(let line=effect.value;line<=tr.state.doc.lines;line++) if(line>0) ranges.push(Decoration.line({class:'live-code-added'}).range(tr.state.doc.line(line).from));
   value=Decoration.set(ranges);
  }
  return value;
 },provide:field=>EditorView.decorations.from(field)
});
const highlight=HighlightStyle.define([
 {tag:tags.keyword,color:'#ff79c6'},
 {tag:[tags.string,tags.special(tags.string)],color:'#f1fa8c'},
 {tag:[tags.number,tags.bool,tags.null],color:'#bd93f9'},
 {tag:[tags.function(tags.variableName),tags.function(tags.propertyName)],color:'#50fa7b'},
 {tag:[tags.typeName,tags.className,tags.tagName],color:'#8be9fd'},
 {tag:[tags.comment],color:'#9296b3',fontStyle:'italic'},
 {tag:tags.attributeName,color:'#8be9fd'},
 {tag:tags.operator,color:'#ff79c6'},
]);
export function CodeSurface({code,language,addedFrom,follow,label,caret=false,streaming=false}:{code:string;language:string;addedFrom:number;follow:boolean;label:string;caret?:boolean;streaming?:boolean}){
 const host=useRef<HTMLDivElement>(null);
 const editor=useRef<EditorView|null>(null);
 useEffect(()=>{
  if(!host.current)return;
  const view=new EditorView({parent:host.current,state:EditorState.create({extensions:[
   lineNumbers(),foldGutter(),highlightActiveLineGutter(),bracketMatching(),lines,caretField,
   language==='css'?css():javascript({jsx:true,typescript:true}),syntaxHighlighting(highlight),
   EditorState.readOnly.of(true),EditorView.editable.of(false),
   EditorView.contentAttributes.of({'aria-label':label}),
   EditorView.theme({'&':{height:'100%',color:'#e4e4e0',backgroundColor:'#252733'},'.cm-scroller':{fontFamily:'Cascadia Code, Consolas, monospace',fontSize:'12px',lineHeight:'1.85',overflow:'auto'},'.cm-content':{padding:'18px 0 180px'},'.cm-line':{padding:'0 20px 0 12px'},'.cm-gutters':{backgroundColor:'#252733',color:'#7f8296',border:'none',paddingLeft:'12px'},'.cm-activeLineGutter':{backgroundColor:'transparent'},'&.cm-focused':{outline:'none'},'.cm-selectionBackground':{backgroundColor:'#44475a !important'}},{dark:true}),
  ]})});
  editor.current=view;
  return()=>{view.destroy();editor.current=null;};
 },[language,label]);
 useEffect(()=>{
  const view=editor.current;if(!view)return;
  const previous=view.state.doc.toString();
  let from=0,end=previous.length,nextEnd=code.length;
  while(from<end&&from<nextEnd&&previous[from]===code[from])from++;
  while(end>from&&nextEnd>from&&previous[end-1]===code[nextEnd-1]){end--;nextEnd--;}
  view.dispatch({changes:{from,to:end,insert:code.slice(from,nextEnd)},effects:[changed.of(addedFrom),writing.of(caret)]});
  if(follow)view.dispatch({effects:EditorView.scrollIntoView(view.state.doc.length,{y:'nearest',yMargin:65})});
 },[code,addedFrom,follow,caret,language,label]);
 return <div className="code-surface" data-streaming={streaming} ref={host}/>;
}
