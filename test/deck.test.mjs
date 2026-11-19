import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { makeRequest, parseDeck, sampleDeck, sampleNotes } from "../bundle/deck.js";
import { createPresentation, fileName } from "../bundle/export.js";

const response = (text, stopReason = "endTurn") => ({ content: { text }, stopReason });

test("accepts plain and fenced model JSON and preserves source figures", () => {
  const text = JSON.stringify(sampleDeck);
  assert.deepEqual(parseDeck(response(text)), sampleDeck);
  assert.deepEqual(parseDeck(response("```json\n" + text + "\n```")), sampleDeck);
  assert.match(text, /18 分钟降至 11 分钟/);
  assert.match(text, /100%/);
});

test("rejects failures before replacing the draft", () => {
  assert.throws(() => parseDeck(response("{}", "maxTokens")), /截断/);
  assert.throws(() => parseDeck(response("{}", "contentFilter")), /无法生成/);
  assert.throws(() => parseDeck(response("not json")), /无法读取/);
  assert.throws(() => parseDeck(response('{"slides":null}')), /页数/);
  const invalid = structuredClone(sampleDeck);
  invalid.slides[3].points[0] = "字".repeat(57);
  assert.throws(() => parseDeck(response(JSON.stringify(invalid))), /第 4 页/);
});

test("uses one bounded host completion with original notes and explicit audience", () => {
  const request = makeRequest(sampleNotes, " 项目负责人 ");
  assert.equal(request.messages.length, 1);
  assert.equal(request.maxTokens, 1800);
  const [, input] = request.messages[0].content.text.split(/\n(?=\{"audience":)/);
  assert.deepEqual(JSON.parse(input), { audience: "项目负责人", notes: sampleNotes });
});

test("writes the adjusted wording as native text in a six-slide PowerPoint", async () => {
  const edited = structuredClone(sampleDeck);
  edited.slides[3].points[0] = "本周补做夜班抽样 & 复核";
  const binary = await createPresentation(edited, PptxGenJS).write({ outputType: "nodebuffer" });
  const pptx = await JSZip.loadAsync(binary);
  assert.equal(pptx.file(/^ppt\/slides\/slide\d+\.xml$/).length, 6);
  const risk = await pptx.file("ppt/slides/slide4.xml").async("string");
  assert.match(risk, /<a:t>本周补做夜班抽样 &amp; 复核<\/a:t>/);
  assert.match(risk, /<p:sp>/);
  assert.doesNotMatch(risk, /夜班样本偏少/);
  assert.equal(fileName("甲/乙"), "甲-乙-BriefDeck.pptx");
});
