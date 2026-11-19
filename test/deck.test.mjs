import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { makeRequest, parseDeck, sampleDeck, sampleNotes, validPageCount } from "../bundle/deck.js";
import { createPresentation, fileName } from "../bundle/export.js";
import { dimensions, movePicture, placePicture, resizePicture, slideLayout, themePalette } from "../bundle/layout.js";
import { archiveMigration, prioritizedPilot, supportPilot } from "./slide-design-fixtures.mjs";
import { readFileSync } from "node:fs";

const realP1Response = JSON.parse(readFileSync(new URL("./fixtures/p1-real-response.json", import.meta.url)));

const response = (text, stopReason = "endTurn") => ({ content: { text }, stopReason });

const deckOf = count => ({ slides: Array.from({ length: count }, (_, index) => structuredClone(sampleDeck.slides[index % 6])) });

test("P1.1 replays the real six-page response and preserves every original point", async () => {
  const deck = parseDeck(realP1Response, 6);
  const raw = JSON.parse(realP1Response.content.text);
  assert.deepEqual(deck.slides.map(slide => slide.points), raw.slides.map(slide => slide.points));
  assert.equal(deck.slides[1].lead, 0);
  assert.equal(deck.slides[5].lead, 1);
  const metric = slideLayout(deck.slides[1], 1, 6);
  assert.ok(metric.elements.some(item => item.value === "18 → 11 分钟" && item.size >= 29));
  assert.ok(metric.elements.some(item => item.value === "缩短约 39%"));
  assert.equal(metric.elements.find(item => item.field === 1).value, raw.slides[1].points[1]);
  const decision = slideLayout(deck.slides[5], 5, 6);
  assert.ok(decision.elements.find(item => item.field === 1).size > decision.elements.find(item => item.field === 0).size);
  const file = await JSZip.loadAsync(await createPresentation(deck, PptxGenJS).write({ outputType: "nodebuffer" }));
  const second = await file.file("ppt/slides/slide2.xml").async("string");
  assert.match(second, /18 → 11 分钟/);
  assert.match(second, /处理工单480单/);
  assert.match(second, /未记录重大客户投诉/);
  assert.doesNotMatch(second, /<p:pic>/);
});

test("P1.1 keeps strict cover contracts and permits no guesses about unlabelled decisions", () => {
  for (const points of [[], ["副标题", "另一个事实"], "副标题", undefined]) {
    const deck = JSON.parse(realP1Response.content.text);
    deck.slides[0].points = points;
    assert.throws(() => parseDeck(response(JSON.stringify(deck)), 6), /第 1 页的要点数量有误/);
  }
  const prompt = makeRequest({ notes: "", audience: "负责人", pageCount: 6 });
  assert.equal(prompt.maxTokens, 1800);
  const text = prompt.messages[0].content.text;
  assert.match(text, /points 必须是恰好包含一个非空字符串的数组/);
  assert.match(text, /正文页 points 必须是 1–3 个非空字符串的数组/);
  assert.match(text, /资料未证明的因果关系不得写为事实/);
  const raw = JSON.parse(realP1Response.content.text);
  raw.slides[5].points[1] = "优先核对迁移条件。";
  assert.equal(parseDeck(response(JSON.stringify(raw)), 6).slides[5].lead, undefined);
  raw.slides[1].design[1][1] = "focus";
  assert.equal(parseDeck(response(JSON.stringify(raw)), 6).slides[1].lead, undefined);
});

test("P1 moves the emphasis with Anna's lead and keeps original facts and legacy layouts", async () => {
  const fixture = structuredClone(prioritizedPilot);
  const leadSlide = () => parseDeck(response(JSON.stringify(fixture)), 4).slides[1];
  const elements = slideLayout(leadSlide(), 1, 4).elements;
  const find = value => elements.find(item => item.value === value);
  assert.ok(find("18 → 11 分钟").size > find("480 单").size);
  assert.ok(find("18 → 11 分钟").w > find("480 单").w);
  assert.ok(find("缩短约 39%"));
  assert.ok(find("本周处理 · 覆盖 2 个业务组。"));
  assert.equal(find("首次响应中位数").field, 1);
  assert.equal(find("人工复核覆盖率").field, 2);
  const deck = parseDeck(response(JSON.stringify(fixture)), 4);
  const binary = await createPresentation(deck, PptxGenJS).write({ outputType: "nodebuffer" });
  const zipped = await JSZip.loadAsync(binary);
  const xml = await zipped.file("ppt/slides/slide2.xml").async("string");
  assert.match(xml, /<a:t>18 → 11 分钟<\/a:t>/);
  assert.match(xml, /<a:t>缩短约 39%<\/a:t>/);
  assert.doesNotMatch(xml, /首次响应中位数由 18 分钟/);

  fixture.slides[1].lead = 2;
  const changed = slideLayout(leadSlide(), 1, 4).elements;
  assert.ok(changed.find(item => item.value === "100%").size > changed.find(item => item.value === "18 → 11 分钟").size);
  const ordinary = { ...fixture.slides[1], lead: undefined };
  for (const lead of [undefined, "1", -1, 3, 1.5]) {
    fixture.slides[1].lead = lead;
    assert.equal(leadSlide().lead, undefined);
    assert.deepEqual(slideLayout(leadSlide(), 1, 4), slideLayout(ordinary, 1, 4));
  }
  fixture.slides[1].layout = "risk";
  fixture.slides[1].lead = 1;
  assert.equal(leadSlide().lead, undefined);
  fixture.slides[1].layout = "metrics";
  fixture.slides[1].points[1] = "试点由 18 分钟降至 11 分钟，仅限工作日。";
  const qualifier = slideLayout(leadSlide(), 1, 4).elements.find(item => item.field === 1);
  assert.match(qualifier.value, /仅限工作日/);
  fixture.slides[1].points[1] = "响应由 0 分钟增至 11 分钟。";
  assert.ok(!slideLayout(leadSlide(), 1, 4).elements.some(item => /^(缩短|上升|下降)约/.test(item.value ?? "")));
  fixture.slides[1].points[1] = "响应中位数：18→11 分钟";
  assert.ok(slideLayout(leadSlide(), 1, 4).elements.some(item => item.value === "18 → 11 分钟"));
});

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
  assert.match(mixed.messages[0].content[0].text, /metrics 指标/);
  assert.match(mixed.messages[0].content[0].text, /正文标题写可核对的结论/);
  assert.deepEqual(mixed.messages[0].content[1], images[0]);
  assert.ok(mixed.modelPreferences);
});

test("M2.4 renders distinct semantic layouts, preserves source metrics and falls back for unknown layouts", async () => {
  const slides = parseDeck(response(JSON.stringify(sampleDeck))).slides;
  const names = slides.map((slide, i) => slideLayout(slide, i, slides.length).name);
  assert.deepEqual(names, ["cover", "metrics", "progress", "risk", "actions", "decision"]);
  const metrics = slideLayout(slides[1], 1, slides.length);
  for (const value of ["480 单", "18 → 11 分钟", "100%"]) {
    assert.ok(metrics.elements.some(element => element.kind === "text" && element.value === value));
  }
  const noFigures = slideLayout({ layout: "metrics", title: "待复核", points: ["汇报材料未提供指标。"] }, 1, 4);
  assert.ok(noFigures.elements.some(element => element.value === "汇报材料未提供指标。"));
  assert.ok(!noFigures.elements.some(element => element.size >= 32));
  const unknown = deckOf(4);
  unknown.slides[1].layout = "custom-code";
  unknown.slides[1].composition = "custom-code";
  const safe = parseDeck(response(JSON.stringify(unknown)), 4);
  assert.equal(slideLayout(safe.slides[1], 1, 4).name, "summary");
  assert.equal(safe.slides[1].composition, undefined);
  const alternatives = deckOf(4);
  alternatives.slides[1].composition = "stack";
  const stacked = parseDeck(response(JSON.stringify(alternatives)), 4).slides[1];
  assert.equal(stacked.composition, "stack");
  const stackedElements = slideLayout(stacked, 1, 4).elements;
  assert.notDeepEqual(stackedElements.filter(item => item.kind === "rect"), metrics.elements.filter(item => item.kind === "rect"));
  for (const value of ["480 单", "18 → 11 分钟", "100%"]) {
    assert.ok(stackedElements.some(item => item.value === value));
  }
  const pptx = await JSZip.loadAsync(await createPresentation({ slides }, PptxGenJS).write({ outputType: "nodebuffer" }));
  const metricXml = await pptx.file("ppt/slides/slide2.xml").async("string");
  assert.match(metricXml, /<a:t>18 → 11 分钟<\/a:t>/);
  assert.match(metricXml, /<a:t>480 单<\/a:t>/);
  assert.match(await pptx.file("ppt/slides/slide4.xml").async("string"), /<a:t>风险与应对<\/a:t>/);
});

test("M5.1–M5.2 validate flexible geometry and export it as native text and shapes", async () => {
  const pilot = parseDeck(response(JSON.stringify(supportPilot)), 4);
  const migration = parseDeck(response(JSON.stringify(archiveMigration)), 4);
  const compare = slideLayout(pilot.slides[1], 1, 4);
  const timeline = slideLayout(migration.slides[1], 1, 4);
  assert.ok(compare.elements.some(item => item.value === "前  18 分钟"));
  assert.ok(compare.elements.some(item => item.value === "后  11 分钟"));
  const positions = timeline.elements.filter(item => typeof item.field === "number");
  assert.equal(new Set(positions.map(item => item.x)).size, 3);
  assert.equal(new Set(positions.map(item => item.y)).size, 1);

  const plotBelow = structuredClone(supportPilot);
  plotBelow.slides[1].design = [[0, "compare", 0, 5, 12, 7], [1, "focus", 0, 0, 6, 5], [2, "text", 6, 0, 6, 5]];
  const alternative = parseDeck(response(JSON.stringify(plotBelow)), 4);
  const findPoint = layout => layout.elements.find(item => item.field === 0);
  const shifted = findPoint(slideLayout(alternative.slides[1], 1, 4));
  assert.ok(shifted.y > findPoint(compare).y);
  assert.equal(shifted.value, findPoint(compare).value);
  const binary = await createPresentation(alternative, PptxGenJS).write({ outputType: "nodebuffer" });
  const zipped = await JSZip.loadAsync(binary);
  const xml = await zipped.file("ppt/slides/slide2.xml").async("string");
  assert.match(xml, /<a:t>后  11 分钟<\/a:t>/);
  assert.match(xml, new RegExp(`y="${Math.round(shifted.y * 914400)}"`));
  assert.doesNotMatch(xml, /<p:pic>/);
  for (const value of ["由 -18 分钟升至 -11 分钟。", "响应速度已有改善。"]) {
    const changed = structuredClone(pilot.slides[1]);
    changed.points[0] = value;
    const rendered = slideLayout(changed, 1, 4).elements;
    assert.equal(rendered.length, compare.elements.length);
    assert.ok(rendered.some(item => item.field === 0 && item.value === value));
    assert.ok(!rendered.some(item => item.value?.startsWith("前  ")));
  }

  const invalid = [
    [[0, "compare", 7, 0, 8, 12], [1, "focus", 8, 0, 4, 6], [2, "text", 8, 6, 4, 6]],
    [[0, "compare", 0, 0, 8, 12], [1, "focus", 7, 0, 5, 6], [2, "text", 8, 6, 4, 6]],
    [[0, "compare", 0, 0, 8, 12], [0, "focus", 8, 0, 4, 6], [2, "text", 8, 6, 4, 6]],
    [[0, "html", 0, 0, 8, 12], [1, "focus", 8, 0, 4, 6], [2, "text", 8, 6, 4, 6]],
    [[0, "compare", 0, 0, 8, 12]]
  ];
  for (const design of invalid) {
    const candidate = structuredClone(supportPilot);
    candidate.slides[1].design = design;
    const fallback = parseDeck(response(JSON.stringify(candidate)), 4);
    assert.equal(fallback.slides[1].design, undefined);
    assert.deepEqual(fallback.slides[1].points, pilot.slides[1].points);
    assert.equal(slideLayout(fallback.slides[1], 1, 4).name, "metrics");
  }
});

test("M1.6 and M2.5 send style and optional instructions in one bounded request", async () => {
  const request = makeRequest({
    notes: sampleNotes, audience: "", pageCount: 5, instructions: "重点讲风险和下一步",
    style: { theme: "technology", accent: "a837e0" }
  });
  assert.equal(request.messages.length, 1);
  assert.equal(request.maxTokens, 1500);
  assert.match(request.messages[0].content.text, /恰好 5 页/);
  assert.match(request.messages[0].content.text, /"instructions":"重点讲风险和下一步"/);
  assert.match(request.messages[0].content.text, /保持资料中的事实/);
  assert.match(request.messages[0].content.text, /科技风：有数据时突出量化对比/);
  assert.deepEqual(JSON.parse(request.messages[0].content.text.split("\n").at(-1)).style, { theme: "technology", accent: "#A837E0" });
  const bounded = makeRequest({ notes: "", audience: "", pageCount: 4, instructions: "字".repeat(301) });
  assert.equal(JSON.parse(bounded.messages[0].content.text.split("\n").at(-1)).instructions.length, 300);

  const metrics = sampleDeck.slides[1];
  const styled = slideLayout(metrics, 1, 6, { theme: "technology", accent: "a837e0" });
  assert.equal(styled.name, "metrics");
  const palette = themePalette("technology", "a837e0");
  assert.notEqual(styled.background, "0B1527");
  assert.equal(styled.background, palette.background);
  assert.ok(styled.elements.some(element => element.kind === "rect" && element.w > 3 && element.h > 3 && element.color === palette.forest));
  assert.ok(styled.elements.some(element => element.kind === "rect" && element.color === "A837E0"));
  assert.ok(styled.elements.some(element => element.value === "480 单"));
  const file = await JSZip.loadAsync(await createPresentation(sampleDeck, PptxGenJS, { theme: "technology", accent: "a837e0" }).write({ outputType: "nodebuffer" }));
  const xml = await file.file("ppt/slides/slide2.xml").async("string");
  assert.match(xml, new RegExp(`<p:bg>.*?val="${palette.background}"`));
  assert.match(xml, /val="A837E0"/);
  assert.match(xml, /<a:t>480 单<\/a:t>/);
});

test("M5.3 keeps text contrast on large areas derived from custom colors", () => {
  const luminance = hex => [0, 2, 4].map((offset, index) => {
    const rgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const channel = rgb <= 0.04045 ? rgb / 12.92 : ((rgb + 0.055) / 1.055) ** 2.4;
    return channel * [0.2126, 0.7152, 0.0722][index];
  }).reduce((sum, channel) => sum + channel, 0);
  for (const theme of ["minimal", "technology"]) {
    for (const accent of ["D7AB79", "FF00FF", "FFFFFF", "000000"]) {
      const palette = themePalette(theme, accent);
      const baseline = themePalette(theme);
      assert.notEqual(palette.forest, baseline.forest);
      assert.notEqual(palette.sage, baseline.sage);
      for (const [color, background] of [[palette.white, palette.forest], [palette.mint, palette.forest],
        [palette.ink, palette.sage], [palette.ink, palette.paper], [palette.heading, palette.background],
        [palette.muted, palette.background]]) {
        const [light, dark] = [luminance(color), luminance(background)].sort((a, b) => b - a);
        assert.ok((light + 0.05) / (dark + 0.05) >= 4.5, `${theme} #${accent}: #${color} over #${background}`);
      }
    }
  }
});

test("M3.4 keeps text layout while bounding and scaling independent pictures", () => {
  const pictures = [[1800, 320], [320, 1800]].map(([width, height], index) => {
    const origin = placePicture({ width, height }, index);
    const moved = movePicture(origin, -100, -100);
    assert.equal(moved.x, 0);
    assert.equal(moved.y, 0);
    const frame = resizePicture(moved, 100, 100);
    assert.ok(Math.abs(frame.w / frame.h - width / height) < 0.001);
    assert.ok(frame.w <= dimensions.width + 0.001 && frame.h <= dimensions.height + 0.001);
    const smallest = resizePicture(frame, -100, -100);
    assert.ok(Math.abs(Math.max(smallest.w, smallest.h) - 0.25) < 0.001);
    return { width, height, frame };
  });
  for (const index of [0, 1, 3]) {
    const slide = sampleDeck.slides[index];
    const baseline = slideLayout(slide, index, 6, { theme: "technology" });
    const updated = slideLayout({ ...slide, pictures }, index, 6, { theme: "technology" });
    assert.deepEqual(updated.elements.filter(item => item.kind !== "image"), baseline.elements);
    assert.deepEqual(updated.elements.filter(item => item.kind === "image").map(item => item.picture), pictures);
  }
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
