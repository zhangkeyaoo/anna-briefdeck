import {test} from "node:test";
import assert from "node:assert/strict";
import {sampleDeck} from "../bundle/deck.js";
import {creditSummary,formatCredits,runRedesignOperation} from "../bundle/redesign-operation.js";
const valid={design:[[0,"focus",0,0,6,11],[1,"text",6,0,6,5],[2,"text",6,6,6,5]]};
const invalid={design:[[0,"text",0,0,4,4],[1,"text",4,0,4,5],[2,"text",8,0,4,5]]};
const reply=(raw,cost)=>({stopReason:"endTurn",model:"mock",content:{text:JSON.stringify(raw)},usage:{inputTokens:1,outputTokens:2},_meta:{quotaConsumed:cost}});
for(const succeedAt of [1,2,3,4])test(`P2.5 controlled correction stops on success ${succeedAt}`,async()=>{
 const slide=structuredClone(sampleDeck.slides[1]);const before=structuredClone(slide);let calls=0;
 const result=await runRedesignOperation({slide,index:1,total:6,complete:async request=>{
  calls++;const payload=JSON.parse(request.messages[0].content.text.split("\n").at(-1));
  if(calls>1){assert.equal(payload.correction.failedAttempts.length,calls-1);assert.match(payload.correction.failedAttempts[0].error,/高度4小于最小5/);}
  if(calls===4)assert.equal(payload.correction.alternativeOnly,true);
  return reply(calls===succeedAt?(calls===4?payload.compatibleProposals[0]:valid):invalid,calls/10);
 }});
 assert.equal(calls,succeedAt);assert.equal(result.operation.status,"candidate");assert.ok(result.candidate);
 assert.equal(result.operation.credits.total,["0.1","0.3","0.6","1"][succeedAt-1]);
 assert.deepEqual(slide,before);assert.equal(result.operation.attempts.at(-1).status,"succeeded");
});
test("P2.5 four failed validations stop, while protected fields and request errors stop early",async()=>{
 for(const mode of ["invalid","protected","network"]){let calls=0;const slide=structuredClone(sampleDeck.slides[1]);const before=structuredClone(slide);
  const result=await runRedesignOperation({slide,index:1,total:6,complete:async()=>{calls++;if(mode==="network")throw Error("network");return reply(mode==="protected"?{points:["forbidden"]}:invalid,0.1);}});
  assert.equal(calls,mode==="invalid"?4:1);assert.equal(result.operation.status,"failed");assert.equal(result.candidate,undefined);assert.deepEqual(slide,before);
  assert.equal(result.operation.credits.unknown,mode==="network"?1:0);
 }
});
test("P2.5 cancellation and expiry collect the late receipt without starting a repair",async()=>{
 for(const kind of ["cancelled","expired"])for(const stopAt of [1,3]){let cancelled=false,current=true,calls=0;
  const result=await runRedesignOperation({slide:structuredClone(sampleDeck.slides[1]),index:1,total:6,isCancelled:()=>cancelled,isCurrent:()=>current,
   complete:async()=>{calls++;if(calls===stopAt){if(kind==="cancelled")cancelled=true;else current=false;}return reply(invalid,0.123456789);}});
  assert.equal(calls,stopAt);assert.equal(result.operation.status,kind);assert.equal(result.operation.attempts.at(-1).status,kind);assert.equal(result.operation.credits.total,stopAt===1?"0.123456789":"0.370370367");assert.equal(result.candidate,undefined);
 }
});
test("P2.5 impossible grid and absent alternatives stop before calling, and final free grid cannot replace the alternative policy",async()=>{
 const dense={layout:"summary",title:"逐条复核",points:Array.from({length:12},(_,i)=>`事项${i+1}：复核`)};let calls=0;
 const none=await runRedesignOperation({slide:dense,index:1,total:6,complete:async()=>{calls++;return reply(invalid,0);}});
 assert.equal(calls,0);assert.equal(none.operation.reason,"NO_FEASIBLE_DESIGN");
 const result=await runRedesignOperation({slide:structuredClone(sampleDeck.slides[1]),index:1,total:6,complete:async()=>reply(++calls===4?valid:invalid,0)});
 assert.equal(calls,4);assert.equal(result.operation.status,"failed");assert.equal(result.operation.attempts[3].code,"FINAL_ALTERNATIVE");
});
test("public credits add provider decimals exactly, retain unknown receipts and never show model or tokens",()=>{
 assert.deepEqual(creditSummary([{quotaConsumed:0.1},{quotaConsumed:0.2}]),{total:"0.3",unknown:0});
 assert.equal(creditSummary([{quotaConsumed:1e-7},{quotaConsumed:2e-7}]).total,"0.0000003");
 assert.equal(formatCredits(creditSummary([{quotaConsumed:0.10258620689655172}])),"本次消耗 0.10 积分。");
 assert.match(formatCredits(creditSummary([{quotaConsumed:0.2},{}])),/0.20 积分.*待平台确认/);
});
