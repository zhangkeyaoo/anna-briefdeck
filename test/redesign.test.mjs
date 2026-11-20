import {test} from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import {sampleDeck} from "../bundle/deck.js";
import {createPresentation} from "../bundle/export.js";
import {parseSlideDesign} from "../bundle/slide-design.js";
import {makeRedesignRequest,parseRedesignResponse,pageSignature,visualSnapshot,restoreVisual,visualFingerprint} from "../bundle/redesign.js";
import {layoutOptions,slideLayout,withLayoutChoice} from "../bundle/layout.js";
import {snapshotDraft,restoreDraft} from "../bundle/library.js";
const response=raw=>({stopReason:"endTurn",content:{text:typeof raw==="string"?raw:JSON.stringify(raw)}});
const grid={intent:"首条重点，后续两项并列说明",design:[[0,"focus",0,0,6,12],[1,"text",6,0,6,6],[2,"text",6,6,6,6]]};

test("P2.5 real five-point grid violates the advertised minimum height and must remain rejected",()=>{
 const design=[[0,"focus",0,0,12,5],[1,"text",0,5,6,4],[2,"text",6,5,6,4],[3,"text",0,9,6,3],[4,"text",6,9,6,3]];
 const base={layout:"risk",title:"五项待核对问题",points:Array.from({length:5},(_,i)=>`问题${i+1}：尚未完成，待进一步核对。`)};
 const before=structuredClone(base);
 assert.equal(parseSlideDesign(design,5),undefined);
 assert.deepEqual(design.find(item=>item[4]<4||item[5]<5),[1,"text",0,5,6,4]);
 assert.throws(()=>parseRedesignResponse(response({design}),base,2,6),/网格设计/);
 assert.deepEqual(base,before);
 assert.match(makeRedesignRequest(base,2,6).messages[0].content.text,/12×12整数网格，元素最小4×5/);
 const valid=[[0,"focus",0,0,4,6],[1,"text",4,0,4,6],[2,"text",8,0,4,6],[3,"text",0,6,6,6],[4,"text",6,6,6,6]];
 assert.ok(parseSlideDesign(valid,5));
 const candidate=parseRedesignResponse(response({design:valid}),base,2,6).candidate;
 assert.deepEqual(candidate.points,base.points);
});

test("P2.5.1 request contains only the current page, safe geometry and image frames in one bounded call",()=>{
 const base=structuredClone(sampleDeck.slides[1]);
 base.points[1]="用户已编辑的完整正文与统计口径。";
 base.pictures=[{data:"PRIVATE_IMAGE_BYTES",name:"PRIVATE_FILENAME",frame:{x:11.9,y:7.1,w:0.2,h:0.2}}];
 const request=makeRedesignRequest(base,1,6,{theme:"minimal"});
 assert.equal(request.messages.length,1);assert.equal(request.maxTokens,900);assert.equal(request.thinking,false);
 const text=request.messages[0].content.text;
 assert.ok(text.includes(base.points[1]));
 assert.ok(!text.includes("PRIVATE_IMAGE_BYTES"));assert.ok(!text.includes("PRIVATE_FILENAME"));
 assert.ok(!text.includes(sampleDeck.slides[5].title));
 assert.ok(!Object.hasOwn(request,"modelPreferences"));
 assert.throws(()=>makeRedesignRequest(sampleDeck.slides[0],0,6),/封面/);
});

test("P2.5.2 custom grid and compatible choices preserve all authoritative data and produce a different native layout",async()=>{
 const base=structuredClone(sampleDeck.slides[1]);
 base.pictures=[{data:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",name:"test.png",width:1,height:1,frame:{x:11.9,y:7.1,w:0.2,h:0.2}}];
 const before=structuredClone(base);
 const {candidate}=parseRedesignResponse(response(grid),base,1,6);
 assert.deepEqual(base,before);
 assert.equal(candidate.title,base.title);assert.deepEqual(candidate.points,base.points);assert.equal(candidate.pictures,base.pictures);
 assert.notEqual(visualFingerprint(candidate,1,6),visualFingerprint(base,1,6));
 assert.ok(slideLayout(candidate,1,6).elements.some(item=>item.component==="ai-redesign"));
 const deck=structuredClone(sampleDeck);deck.slides[1]=candidate;
 const zip=await JSZip.loadAsync(await createPresentation(deck,PptxGenJS).write({outputType:"nodebuffer"}));
 const xml=await zip.file("ppt/slides/slide2.xml").async("string");
 const text=[...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map(m=>m[1]).join("");
 for(const point of base.points)assert.ok(text.includes(point));
 assert.equal([...xml.matchAll(/<p:pic>/g)].length,1);assert.match(xml,/<p:sp>/);
  for(const item of slideLayout(candidate,1,6).elements.filter(item=>item.field!==undefined)) {
    assert.ok(xml.includes(`x="${Math.round(item.x*914400)}"`));
    assert.ok(xml.includes(`y="${Math.round(item.y*914400)}"`));
    assert.ok(xml.includes(`sz="${Math.round(item.size*100)}"`));
  }
 const manual=parseRedesignResponse(response({manualLayout:"plain"}),base,1,6).candidate;
 assert.deepEqual(manual.points,base.points);
});

test("P2.5.2 invalid, executable, identical or incomplete designs fail without touching the original",()=>{
 const base=structuredClone(sampleDeck.slides[1]);const before=structuredClone(base);
 for(const raw of [
  {title:"篡改标题",design:grid.design},{points:["删减正文"],design:grid.design},{metric:{kind:"single"},design:grid.design},
  {html:"<script>alert(1)</script>"},{design:[[0,"text",0,0,4,5]]},
  {design:[[0,"text",0,0,6,12],[1,"text",0,0,6,6],[2,"text",6,6,6,6]]},
  {design:[[0,"text",0,0,6,12],[1,"text",6,0,6,6],[1,"text",6,6,6,6]]},
  {design:[[0,"text",0,0,6,12],[1,"text",6,0,7,6],[2,"text",6,6,6,6]]},
  {design:[[0,"text",6,6,6,6],[1,"text",0,0,6,12],[2,"text",6,0,6,6]]},
  {design:[[0,"compare",0,0,6,12],[1,"text",6,0,6,6],[2,"text",6,6,6,6]]},
  {layout:"risk",manualLayout:"plain"},{manualLayout:"unknown"},{},[],"<html>bad</html>"
 ]) {assert.throws(()=>parseRedesignResponse(response(raw),base,1,6));assert.deepEqual(base,before);}
 const plain={...base,manualLayout:"plain"};
 assert.throws(()=>parseRedesignResponse(response({manualLayout:"plain"}),plain,1,6),/相同/);
 assert.throws(()=>parseRedesignResponse({...response(grid),stopReason:"maxTokens"},base,1,6),/截断/);
});

test("P2.5.3 visual undo never restores old prose, metrics or pictures; history preserves reset and candidate",async()=>{
 const deck=structuredClone(sampleDeck);const base=deck.slides[1];
 const initial=visualSnapshot(base);
 const {candidate}=parseRedesignResponse(response(grid),base,1,6);
 restoreVisual(base,visualSnapshot(candidate));
 base.redesignOriginal=initial;base.redesignTrace={customGrid:true,rawText:JSON.stringify(grid),quotaConsumed:0};
 const restored=await restoreDraft(snapshotDraft("redesign",deck,{}));assert.deepEqual(restored,deck);
 const originalSignature=pageSignature(base,{});
 base.points[0]="保留用户后来编辑的内容。";
 assert.notEqual(pageSignature(base,{}),originalSignature);
 const text=[...base.points];
 restoreVisual(base,base.redesignOriginal);assert.deepEqual(base.points,text);
 assert.deepEqual(visualSnapshot(base),initial);
 const switched=withLayoutChoice(restored.slides[1],1,6,"plain");
 assert.ok(layoutOptions(switched,1).some(item=>item.id==="ai-design"));
 const again=withLayoutChoice(switched,1,6,"ai-design");
 assert.equal(again.manualLayout,"ai-design");
});

test("P2.5.4 new image obstruction is rejected while existing safe pictures remain unchanged",()=>{
 const base=structuredClone(sampleDeck.slides[1]);
 // The existing row of cards ends at6.22; the new tall grid would place text behind this image.
 base.pictures=[{frame:{x:0.95,y:6.25,w:1,h:0.15},data:"unchanged",name:"proof"}];
 const before=structuredClone(base);
 assert.throws(()=>parseRedesignResponse(response(grid),base,1,6),/遮挡/);
 assert.deepEqual(base,before);
});

test("P2.5 edited and invalidated metric pages still allow text-only redesign without reviving old charts",()=>{
 const base=structuredClone(sampleDeck.slides[1]);
 base.points[0]="当前数据口径已调整，保留用户最新修改。";base.metricInvalidated=true;
 const candidate=parseRedesignResponse(response(grid),base,1,6).candidate;
 assert.equal(candidate.metricInvalidated,true);
 const layout=slideLayout(candidate,1,6);
 assert.ok(layout.elements.some(item=>item.component==="ai-redesign"));
 assert.ok(!layout.elements.some(item=>item.metricPart));
 assert.equal(layout.elements.find(item=>item.field===0).value.replaceAll("\n",""),base.points[0]);
});

test("P2.5 prompt advertises only combinations accepted by the same strict validator",()=>{
 const risk={layout:"risk",title:"待核对的五项风险",points:Array.from({length:5},(_,i)=>`风险${i+1}：事项尚待复核，不能认定已完成。`)};
 const before=structuredClone(risk);
 const request=makeRedesignRequest(risk,2,6);
 const payload=JSON.parse(request.messages[0].content.text.split("\n").at(-1));
 assert.ok(payload.compatibleProposals.length>0);
 for(const proposal of payload.compatibleProposals){
  assert.ok(!Object.hasOwn(proposal,"lead"));
  assert.notEqual(proposal.composition,"stack");
  const result=parseRedesignResponse(response(proposal),risk,2,6);assert.deepEqual(result.candidate.points,risk.points);
 }
 assert.doesNotMatch(request.messages[0].content.text,/"composition":"cards或stack或spotlight","lead":0/);
 assert.throws(()=>parseRedesignResponse(response({composition:"stack",lead:0}),risk,2,6),/重点索引/);
 assert.throws(()=>parseRedesignResponse(response({composition:"stack"}),risk,2,6),/无法.*排下/);
 assert.deepEqual(risk,before);
});
