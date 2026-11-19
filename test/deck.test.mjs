import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { makeRequest, parseDeck, sampleDeck, sampleNotes, validPageCount } from "../bundle/deck.js";
import { createPresentation, fileName } from "../bundle/export.js";

const response = (text, stopReason = "endTurn") => ({ content: { text }, stopReason });

const deckOf = count => ({ slides: Array.from({ length: count }, (_, index) => structuredClone(sampleDeck.slides[index % 6])) });

test("M1.3 validates integer page counts from 4 through 12", () => {
  for (const count of [4, 5, 6, 9, 12]) assert.equal(validPageCount(count), true);
  for (const count of [3, 13, 4.5, NaN, "6", ""]) assert.equal(validPageCount(count), false);
});

test("M2.1 accepts plain and fenced model JSON with the chosen length", () => {
  const text = JSON.stringify(sampleDeck);
  assert.deepEqual(parseDeck(response(text)), sampleDeck);
  assert.deepEqual(parseDeck(response("```json\n" + text + "\n```")), sampleDeck);
  assert.match(text, /18 分钟降至 11 分钟/);
  assert.match(text, /100%/);
  for (const count of [4, 5, 6, 9, 12]) {
    const deck = deckOf(count);
    assert.deepEqual(parseDeck(response(JSON.stringify(deck)), count), deck);
  }
});

test("M2.1 rejects truncated, filtered, malformed or incorrectly sized decks", () => {
  assert.throws(() => parseDeck(response("{}", "maxTokens")), /截断/);
  assert.throws(() => parseDeck(response("{}", "contentFilter")), /无法生成/);
  assert.throws(() => parseDeck(response("not json")), /无法读取/);
  assert.throws(() => parseDeck(response('{"slides":null}')), /页数/);
  assert.throws(() => parseDeck(response(JSON.stringify(sampleDeck)), 12), /12 页/);
  const invalid = structuredClone(sampleDeck);
  invalid.slides[3].points[0] = "字".repeat(57);
  assert.throws(() => parseDeck(response(JSON.stringify(invalid))), /第 4 页/);
});

test("M1.1 and M2.2 use one bounded request with text, document and image", () => {
  const request = makeRequest({ notes: sampleNotes, audience: " 项目负责人 ", pageCount: 6 });
  assert.equal(request.messages.length, 1);
  assert.equal(request.maxTokens, 1800);
  assert.equal(request.thinking, false);
  const [, input] = request.messages[0].content.text.split(/\n(?=\{"audience":)/);
  assert.deepEqual(JSON.parse(input), { audience: "项目负责人", notes: sampleNotes, documents: [] });
  const documents = [{ name: "weekly.docx", text: "480 单" }];
  const images = [{ type: "image", data: "AAAA", mimeType: "image/png" }];
  const mixed = makeRequest({ notes: "", audience: "", pageCount: 12, documents, images });
  assert.equal(mixed.messages.length, 1);
  assert.equal(mixed.maxTokens, 7200);
  assert.equal(makeRequest({ notes: "", audience: "", pageCount: 5, documents, images }).maxTokens, 3000);
  assert.equal(mixed.thinking, false);
  assert.match(mixed.messages[0].content[0].text, /恰好 12 页/);
  assert.match(mixed.messages[0].content[0].text, /"项目组"/);
  assert.match(mixed.messages[0].content[0].text, /480 单/);
  assert.deepEqual(mixed.messages[0].content[1], images[0]);
  assert.ok(mixed.modelPreferences);
});

test("M4.1 writes edited native text and correct page counts for 4, 6 and 12 slides", async () => {
  for (const count of [4, 6, 12]) {
    const edited = deckOf(count);
    edited.slides[3].points[0] = "本周补做夜班抽样 & 复核";
    const binary = await createPresentation(edited, PptxGenJS).write({ outputType: "nodebuffer" });
    const pptx = await JSZip.loadAsync(binary);
    assert.equal(pptx.file(/^ppt\/slides\/slide\d+\.xml$/).length, count);
    const risk = await pptx.file("ppt/slides/slide4.xml").async("string");
    assert.match(risk, /<a:t>本周补做夜班抽样 &amp; 复核<\/a:t>/);
    assert.match(risk, /<p:sp>/);
    assert.doesNotMatch(risk, /夜班样本偏少/);
  }
  assert.equal(fileName("甲/乙"), "甲-乙-BriefDeck.pptx");
});

test("M4.2 exports boundary-length titles and points using native text", async () => {
  const deck = deckOf(4);
  deck.slides[1].title = "题".repeat(28);
  deck.slides[1].points = Array(3).fill("文".repeat(56));
  const binary = await createPresentation(deck, PptxGenJS).write({ outputType: "nodebuffer" });
  const pptx = await JSZip.loadAsync(binary);
  const xml = await pptx.file("ppt/slides/slide2.xml").async("string");
  assert.match(xml, new RegExp(`<a:t>${deck.slides[1].title}</a:t>`));
  assert.equal([...xml.matchAll(new RegExp(`<a:t>${deck.slides[1].points[0]}</a:t>`, "g"))].length, 3);
});
