import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import {parseDeck} from "../bundle/deck.js";
import {parseMetric, invalidateMetricForEdit, resolveMetric} from "../bundle/metric.js";
import {relationshipPlan} from "../bundle/relationships.js";
import {slideLayout, layoutOptions, withLayoutChoice} from "../bundle/layout.js";
import {createPresentation} from "../bundle/export.js";
import {snapshotDraft, restoreDraft} from "../bundle/library.js";
import {renderingDiagnostics} from "../bundle/diagnostics.js";
const diagnostic=JSON.parse(readFileSync(new URL("./fixtures/customer-platform-diagnostic.json",import.meta.url)));
const raw=JSON.parse(diagnostic.originalModelText.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,"$1"));
const replay=()=>parseDeck({content:{text:JSON.stringify(raw)},stopReason:"endTurn"},6);

test("C1 strict equivalent metric expressions accept sourced labels, percentage glyphs and optional nulls",()=>{
 const deck=replay();
 assert.deepEqual(deck.slides[1].metric.values,["680单","800单"]);
 assert.equal(deck.slides[1].metrics.length,2);
 for(const metric of deck.slides[1].metrics) {assert.equal(metric.unit,"%");assert.ok(!Object.hasOwn(metric,"rate"));}
 const cases=[
  [{kind:"completion",point:0,label:"已完成",unit:"份",values:["已完成36份","总计40份"],rate:"90%"},"已完成36份，总计40份，完成率90％"],
  [{kind:"comparison",point:0,label:"质量通过率",unit:"％",values:["当前88%","目标96%"],basis:"target",rate:null},"质量通过率当前88%，目标96%"],
  [{kind:"comparison",point:0,label:"耗时",unit:"分钟",values:["之前12分钟","之后6分钟"]},"耗时之前12分钟，之后6分钟"],
  [{kind:"single",point:0,label:"通过率",unit:"%",values:["90％"]},"通过率90％"]
 ];
 for(const [metric,source]of cases) assert.ok(parseMetric(metric,[source]),source);
 const base={kind:"comparison",point:0,label:"覆盖率",unit:"%",values:["92%","95%"],basis:"target"};
 for(const [metric,points]of [
  [base,["覆盖率92%，满意度95%，目标待确认"]],
  [base,["覆盖率当前92%，满意度目标95%"]],
  [{...base,values:["95%","92%"]},["覆盖率当前92%，目标95%"]],
  [base,["覆盖率当前92%", "目标95%"]],
  [{...base,unit:"分钟",values:["92分钟","95秒"]},["覆盖率当前92分钟，目标95秒"]],
  [{kind:"completion",point:0,label:"完成",unit:"件",values:["1件","0件"]},["完成1件，计划0件"]],
  [{kind:"single",point:0,label:"耗时",unit:"秒",values:["负1秒"]},["耗时负1秒"]],
  [{kind:"single",point:0,label:"耗时",unit:"秒",values:["NaN秒"]},["耗时NaN秒"]],
  [{kind:"single",point:0,label:"完成率",unit:"%",values:["约85%"]},["完成率约85%"]],
  [{kind:"single",point:0,label:"耗时",unit:"秒",values:["18秒"]},["耗时118秒"]]
 ]) assert.equal(parseMetric(metric,points),undefined,JSON.stringify(metric));
 const slide=deck.slides[1]; assert.ok(invalidateMetricForEdit(slide,0,"完成量已修改，待重新统计"));slide.points[0]="完成量已修改，待重新统计";assert.equal(resolveMetric(slide),undefined);
});

test("C2 explicit consecutive steps may have a separate trailing note, never a connected extra node",()=>{
 const slide=replay().slides[4];
 const plan=relationshipPlan(slide);assert.equal(plan.stepCount,4);assert.equal(plan.cells.length,5);
 const elements=slideLayout(slide,4,6).elements;
 assert.equal(elements.filter(item=>item.component==="relation-supplement"&&item.field===4).length,1);
 for(const count of [2,3,5,6]) assert.equal(relationshipPlan({title:"按序执行",layout:"progress",points:Array.from({length:count},(_,i)=>`第${i+1}步：执行明确任务`)}).stepCount,count);
 for(const points of [
  ["第一步：确认","第二步：执行","补充说明：并列要求仅作检查"],
  ["第一步：确认","第二步：执行","检查项并列核对，无先后依赖：安全与质量"]
 ]) assert.equal(relationshipPlan({title:"执行流程",layout:"progress",points}).stepCount,2);
 for(const points of [
  ["检查安全","检查稳定性","检查质量","检查人员"],
  ["11月1日独立检查","11月2日独立检查"],
  ["问题1：沟通不足","问题2：边界不清"],
  ["第一步：确认","第三步：执行"],
  ["第一步：确认","普通事项未声明关系","第二步：执行"],
  ["第一步：确认","第二步：执行","第三阶段：另一独立事项"],
  ["第一步：确认","第二步：执行","风险可能增加"]
 ]) {
  const plan=relationshipPlan({title:"四步流程",layout:"progress",points});
  assert.equal(plan.id,undefined,points.join("；"));
 }
});

test("C3 real replay keeps all text through layout choices, edits, history and native export; risk and roles unchanged",async()=>{
 const deck=replay();deck.generationTrace={rawText:diagnostic.originalModelText,...diagnostic.generation};
 assert.deepEqual(deck.slides.map(s=>s.points),raw.slides.map(s=>s.points));
 assert.equal(relationshipPlan(deck.slides[3]).id,"relation-roles");
 assert.equal(relationshipPlan(deck.slides[2]).id,undefined);
 const report=renderingDiagnostics(deck);
 assert.equal(report.pages[1].mainMetric.valid,true);
 assert.equal(report.pages[1].mainMetric.applied,false,"five dense points retain the previous safe spatial fallback");
 assert.equal(report.pages[4].relationship.applied,true);
 for(const choice of layoutOptions(deck.slides[4],4)) {
  const changed=withLayoutChoice(deck.slides[4],4,6,choice.id);assert.deepEqual(changed.points,raw.slides[4].points);
 }
 const stored=await restoreDraft(snapshotDraft("compat",deck,{}));assert.deepEqual(stored,deck);
 const zip=await JSZip.loadAsync(await createPresentation(stored,PptxGenJS).write({outputType:"nodebuffer"}));
 for(let i=0;i<6;i++) {
  const xml=await zip.file(`ppt/slides/slide${i+1}.xml`).async("string");
  const text=[...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map(m=>m[1]).join("");
  for(const point of raw.slides[i].points)assert.ok(text.includes(point),point);
  assert.doesNotMatch(xml,/<p:pic>/);
 }
 mkdirSync("release/compat",{recursive:true});
 await createPresentation(stored,PptxGenJS).writeFile({fileName:"release/compat/real-replay.pptx"});
 writeFileSync("release/compat/report.json",JSON.stringify(report,null,2));
});
