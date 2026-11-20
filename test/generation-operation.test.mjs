import {test} from "node:test";
import assert from "node:assert/strict";
import {makeRequest,sampleDeck,generationOutputBudget} from "../bundle/deck.js";
import {runGenerationOperation,retryOutputBudget} from "../bundle/generation-operation.js";
import {creditSummary,formatCredits} from "../bundle/redesign-operation.js";
const request=()=>makeRequest({notes:"完整事实",audience:"管理层",pageCount:6});
const reply=(stopReason="endTurn",cost=0.104)=>({stopReason,content:{type:"text",text:stopReason==="maxTokens"?'{"slides":[':JSON.stringify(sampleDeck)},
  usage:{reasoningTokens:3459},_meta:{quotaConsumed:cost,maxTokens:{limitedBy:"request"}}});

test("whole-deck budgets reserve reasoning capacity, never select a model, and remain within SDK streaming ceiling",()=>{
  let previous=0;
  for(let pages=4;pages<=12;pages++){
    const budget=generationOutputBudget(pages);assert.ok(budget>=previous&&budget<=8192);previous=budget;
    const req=makeRequest({notes:"事实",audience:"管理层",pageCount:pages});assert.equal(req.maxTokens,budget);
    assert.equal(req.model,undefined);assert.equal(req.modelPreferences,undefined);
    assert.ok(retryOutputBudget(req,reply("maxTokens"),pages)>budget);
  }
});
test("forced reasoning truncation retries once with larger budget; receipts sum before formatting",async()=>{
  const calls=[];const result=await runGenerationOperation({request:{...request(),maxTokens:3600},pages:6,complete:async req=>{
    calls.push(req);return reply(calls.length===1?"maxTokens":"endTurn");
  }});
  assert.equal(calls.length,2);assert.ok(calls[1].maxTokens>calls[0].maxTokens);assert.ok(calls[1].maxTokens<=16384);
  assert.equal(result.operation.status,"succeeded");assert.equal(result.operation.credits.total,"0.208");
  assert.equal(formatCredits(result.operation.credits),"本次消耗 0.21 积分。");assert.deepEqual(result.deck.slides.map(s=>s.points),sampleDeck.slides.map(s=>s.points));
});
test("first success makes one call, repeated truncation stops at two, hard caps and unrelated errors never retry",async()=>{
  for(const mode of ["success","cut","model","transport","json","network"]){let calls=0;
    const result=await runGenerationOperation({request:request(),pages:6,complete:async()=>{
      calls++;if(mode==="network")throw Error("network");const response=reply(mode==="success"||mode==="json"?"endTurn":"maxTokens");
      if(mode==="json")response.content.text="broken";
      if(["model","transport"].includes(mode))response._meta.maxTokens={effective:3600,limitedBy:mode};return response;
    }});
    assert.equal(calls,mode==="cut"?2:1);assert.equal(result.operation.status,mode==="success"?"succeeded":"failed");
    if(mode!=="success")assert.equal(result.deck,undefined);
  }
});
test("cancellation and late/expired responses retain receipt but cannot retry or produce a deck",async()=>{
  for(const mode of ["cancelled","expired"]){let cancelled=false,current=true,calls=0;
    const result=await runGenerationOperation({request:request(),pages:6,isCancelled:()=>cancelled,isCurrent:()=>current,complete:async()=>{
      calls++;if(mode==="cancelled")cancelled=true;else current=false;return reply("maxTokens");
    }});
    assert.equal(calls,1);assert.equal(result.deck,undefined);assert.equal(result.operation.status,mode);assert.equal(result.operation.credits.total,"0.104");
  }
});
test("public credits always round only the final total, preserving exact internal receipts",()=>{
  assert.equal(formatCredits(creditSummary([{quotaConsumed:31.40172413793103}])),"本次消耗 31.40 积分。");
  assert.equal(formatCredits(creditSummary([{quotaConsumed:0.1},{quotaConsumed:0.2}])),"本次消耗 0.30 积分。");
  const sum=creditSummary(Array.from({length:4},()=>({quotaConsumed:0.104})));
  assert.equal(sum.total,"0.416");assert.equal(formatCredits(sum),"本次消耗 0.42 积分。");
  assert.equal(formatCredits(creditSummary([{quotaConsumed:0} ])),"本次消耗 0.00 积分。");
  assert.equal(formatCredits(creditSummary([{quotaConsumed:0.995}])),"本次消耗 1.00 积分。");
});
