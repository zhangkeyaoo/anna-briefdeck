import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import JSZip from "jszip";
import { chromium } from "playwright-core";
import { parseDeck, sampleDeck } from "../bundle/deck.js";
import { archiveMigration, prioritizedPilot, supportPilot } from "./slide-design-fixtures.mjs";
import { boundaryLayoutDeck } from "./p2-layout-fixtures.mjs";
import { crossPageExamples, edgeMetricDeck, metricBoundaryDeck, metricExamples } from "./metric-fixtures.mjs";
import { densityDeck, shortDensityDeck } from "./density-fixtures.mjs";
import { knowledgeReviewNumberingDeck } from "./numbering-fixtures.mjs";
import { visualBoundaryDeck, visualDeck } from "./visual-fixtures.mjs";

const origin = "https://briefdeck.test";
const types = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json" };
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
let browser;
let wordBuffer;
const realP1Response = JSON.parse(await readFile(new URL("./fixtures/p1-real-response.json", import.meta.url), "utf8"));
const migrationExcerpt = JSON.parse(await readFile(new URL("./fixtures/p12-migration-excerpt.json", import.meta.url), "utf8"));
const mentorDiagnostic = JSON.parse(await readFile(new URL("./fixtures/mentor-real-diagnostic.json", import.meta.url), "utf8"));
const platformDiagnostic = JSON.parse(await readFile(new URL("./fixtures/customer-platform-diagnostic.json", import.meta.url), "utf8"));

before(async () => {
  const executablePath = process.env.BRIEFDECK_CHROMIUM || (existsSync(chrome) ? chrome : undefined);
  browser = await chromium.launch({ executablePath });
  const zip = new JSZip();
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>本周处理 480 单</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>覆盖 2 个组</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  wordBuffer = await zip.generateAsync({ type: "nodebuffer" });
});
after(async () => browser?.close());

async function serve(route) {
  const { pathname } = new URL(route.request().url());
  if (pathname === "/") {
    const debug=new URL(route.request().url()).searchParams.has("public")?"":"&debug=1";
    return route.fulfill({ contentType: "text/html", body: '<style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" src="/bundle/index.html?wid=test&t=test'+debug+'"></iframe>' });
  }
  if (pathname === "/static/anna-apps/_sdk/latest/index.js") {
    return route.fulfill({ contentType: "text/javascript", body: `
      const slides = ${JSON.stringify(sampleDeck.slides)};
      const designFixtures = ${JSON.stringify([supportPilot, archiveMigration, prioritizedPilot])};
      const readStorage = () => JSON.parse(localStorage.getItem("mockAnnaStorage") ?? "{}");
      const storage = {
        async list({ prefix }) {
          return { items: Object.entries(readStorage()).filter(([key]) => key.startsWith(prefix))
              .map(([key, value]) => ({ key, metadata: value.metadata, etag: value.etag })), next_cursor: null };
        },
        async get({ key }) {
          const result = readStorage()[key];
          return result ? { exists: true, ...result } : { exists: false };
        },
        async set({ key, value, metadata, if_match }) {
          if (window.mockStorageFull) throw Error("quota_exceeded");
          const records = readStorage();
          if (if_match && records[key]?.etag !== if_match) throw Error("precondition_failed");
          const etag = crypto.randomUUID();
          records[key] = { value, metadata, etag };
          localStorage.setItem("mockAnnaStorage", JSON.stringify(records));
          return { etag };
        },
        async delete({ key, if_match }) {
          if (window.mockDeleteFailure) throw Error("unavailable");
          const records = readStorage();
          if (!records[key]) throw { code: "not_found" };
          if (if_match && records[key].etag !== if_match) throw Error("precondition_failed");
          delete records[key];
          localStorage.setItem("mockAnnaStorage", JSON.stringify(records));
        }
      };
      window.requests = [];
      export const AnnaAppRuntime = { async connect() {
        if (window.mockConnectionFailure) throw Error("network");
        return { storage, llm: { async complete(request) {
          window.requests.push(request);
          const response = { stopReason: "endTurn", _meta: { quotaConsumed: 7 } };
          const input = Array.isArray(request.messages[0].content) ? request.messages[0].content[0] : request.messages[0].content;
          const pageTask=JSON.parse(input.text.split("\\n").at(-1));
          if(pageTask.task==="redesign-single-slide") {
            window.redesignCallCount=(window.redesignCallCount??0)+1;
            if(window.holdRedesignResponse)await new Promise(resolve=>{window.releaseRedesignResponse=resolve;});
            if(window.mockRedesignOutcome==="network")throw Error("模拟网络失败");
            const sequence=window.mockRedesignSequence?.[window.redesignCallCount-1];
            const raw=sequence?.alternative?pageTask.compatibleProposals[0]:sequence?.raw??(window.mockRedesignOutcome==="unsafe"?{title:"模型不允许修改正文",html:"<script>window.executed=true</script>"}:
              window.mockRedesignOutcome==="same"?{manualLayout:"plain"}:
              window.mockRedesignRaw??{intent:"首条重点，后续两项分区，避让图片",design:[[0,"focus",0,0,6,11],[1,"text",6,0,6,5],[2,"text",6,6,6,5]]});
            return {stopReason:window.mockRedesignOutcome==="cut"?"maxTokens":"endTurn",model:"mock-redesign",usage:{inputTokens:0,outputTokens:180},_meta:{quotaConsumed:sequence?.cost??0,maxTokens:{effective:900}},content:{text:JSON.stringify(raw)}};
          }
          const count = Number(input.text.match(/恰好 ([0-9]+) 页/)[1]);
          if (window.holdMockResponse) {
            await new Promise(resolve => { window.releaseMockResponse = resolve; });
          } else {
            await new Promise(resolve => setTimeout(resolve, 70));
          }
          if (window.mockOutcome === "quota") throw { code: "quota_exceeded" };
          if (window.mockOutcome === "vision") throw { data: { errorCode: "APP_MODEL_NOT_VISION_CAPABLE" } };
          if (window.mockOutcome === "network") throw Error("network");
          if(window.mockOutcome==="truncated-once") {
            window.fullCallCount=(window.fullCallCount??0)+1;
            return {stopReason:window.fullCallCount===1?"maxTokens":"endTurn",usage:{reasoningTokens:3459},
              _meta:{quotaConsumed:0.104,maxTokens:{effective:request.maxTokens,limitedBy:"request"}},
              content:{type:"text",text:window.fullCallCount===1?'{"slides":[':JSON.stringify({slides})}};
          }
          if (window.mockOutcome === "cut") return {
            stopReason: "maxTokens",
            usage: { outputTokens: 1500 },
            _meta: { quotaConsumed: 14, maxTokens: { effective: 1500, limitedBy: "transport" } }
          };
          if (window.mockOutcome === "json") return { ...response, content: { text: "broken" } };
          if (window.mockOutcome === "real-p1") return ${JSON.stringify(realP1Response)};
          if (window.mockOutcome === "visual") return { stopReason: "endTurn", model: "mock-visual", usage: { inputTokens: 0, outputTokens: 0 }, _meta: { quotaConsumed: 0 }, content: { text: ${JSON.stringify(JSON.stringify(visualDeck()))} } };
          if (window.mockOutcome === "compat") return { stopReason:"endTurn", model:"mock-real-replay", _meta:{quotaConsumed:0}, content:{text:${JSON.stringify(platformDiagnostic.originalModelText)}} };
          if (window.mockOutcome === "mentor-real") return ${JSON.stringify(mentorDiagnostic.response)};
          if (window.mockOutcome === "migration-excerpt") {
            const result = structuredClone(slides);
            const excerpt = ${JSON.stringify(migrationExcerpt)};
            result[1] = { title: excerpt.title, points: excerpt.points, layout: "metrics", lead: 0 };
            return { stopReason: "endTurn", content: { text: JSON.stringify({ slides: result }) }, _meta: { quotaConsumed: 0 } };
          }
          if (window.mockOutcome === "cover-shape") {
            const response = ${JSON.stringify(realP1Response)};
            const parsed = JSON.parse(response.content.text);
            parsed.slides[0].points = ["汇报周期", "覆盖范围"];
            response.content.text = JSON.stringify(parsed);
            return response;
          }
          const fixture = designFixtures.find(fixture => fixture.notes === JSON.parse(input.text.split("\\n").at(-1)).notes);
          if (fixture && count === fixture.slides.length) {
            return { ...response, _meta: { quotaConsumed: 0 }, content: { text: JSON.stringify({ slides: fixture.slides }) } };
          }
          const result = Array.from({ length: count }, (_, i) => structuredClone(slides[i % 6]));
          if (window.mockOutcome === "count") result.pop();
          if (window.mockOutcome === "long") result[1] = { title: "题".repeat(28), points: Array(3).fill("文".repeat(56)) };
          if (window.mockOutcome === "composition") {
            result[1].composition = "stack";
            return { ...response, model: "mock-vision", usage: { inputTokens: 900, outputTokens: 2988, reasoningTokens: 2200 },
              _meta: { quotaConsumed: 25.272413793103443, maxTokens: { effective: 3000 } },
              content: { text: JSON.stringify({ slides: result }) } };
          }
          return { ...response, content: { text: JSON.stringify({ slides: result }) } };
        } } };
      } };` });
  }
  if (/^\/bundle\/[a-z0-9/.-]+$/i.test(pathname)) {
    return route.fulfill({
      contentType: types[pathname.split(".").at(-1)] ?? "text/plain",
      headers: { "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'" },
      body: await readFile(new URL("../release" + pathname, import.meta.url))
    });
  }
  return route.fulfill({ status: 404 });
}

function browserCase(name, run) {
  test(name, async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.route(origin + "/**", serve);
      await page.goto(origin);
      const frame = page.frames().find(item => item.parentFrame());
      await frame.waitForFunction(() => Array.isArray(window.requests));
      await run(page, frame);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

const file = (name, buffer = Buffer.from("测试资料"), mimeType = "application/octet-stream") => ({ name, mimeType, buffer });
async function expandSources(frame) {
  if (await frame.locator("#source-details").getAttribute("open") === null) {
    await frame.locator("#source-summary").press("Enter");
  }
}

async function upload(frame, input) {
  await frame.locator("#sources").setInputFiles(input);
  await expandSources(frame);
}
const status = frame => frame.locator("#status");
const requests = frame => frame.evaluate(() => window.requests);

async function submit(frame, confirm = false) {
  await frame.getByRole("button", { name: "使用 Anna 生成" }).click();
  const continueButton = frame.getByRole("button", { name: "继续" });
  if (confirm && await continueButton.isVisible()) await continueButton.click();
}

async function editSlideText(frame, label, value) {
  await frame.getByRole("button", { name: "编辑" + label, exact: true }).click();
  const field = frame.getByRole("textbox", { name: label + "编辑框", exact: true });
  await field.fill(value);
  await field.press("Enter");
}

async function picture(frame, format, width = 360) {
  const data = await frame.evaluate(({ format, width }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    context.fillStyle = "#e9f4ee";
    context.fillRect(0, 0, width, canvas.height);
    context.fillStyle = "#246b53";
    if (width < 120) {
      context.font = "13px Microsoft YaHei, sans-serif";
      context.fillText("夜班", 15, 33);
      context.fillText("待复核", 8, 60);
    } else {
      context.font = "24px sans-serif";
      context.fillText("18 min → 11 min", 20, 60);
    }
    return canvas.toDataURL("image/" + format).split(",")[1];
  }, { format, width });
  return file("chart." + format, Buffer.from(data, "base64"), "image/" + format);
}

browserCase("M1.1 reads each input type and submits document plus image in one request", async (page, frame) => {
  const png = await picture(frame, "png");
  const jpeg = await picture(frame, "jpeg", 2000);
  const word = file("weekly.docx", wordBuffer);
  const txt = file("weekly.txt", Buffer.from("试点覆盖两个业务组"));
  const cases = [[[], "输入的项目笔记"], [[word], ""], [[txt], ""], [[png], ""], [[jpeg], ""], [[word, png], "补充说明"]];
  for (const [index, [files, notes]] of cases.entries()) {
    await frame.locator("#notes").fill(notes);
    if (files.length) {
      await upload(frame, files);
      await frame.waitForFunction(count => document.querySelectorAll("#source-list li[data-state=ready]").length === count, files.length);
      if (files.includes(word)) {
        await frame.getByText("查看提取文字").click();
        const extracted = await frame.locator("#source-list details p").innerText();
        assert.equal(extracted, "本周处理 480 单\n覆盖 2 个组");
      }
      if (files.includes(png) || files.includes(jpeg)) assert.equal(await frame.locator("#source-list canvas").count(), 1);
    }
    assert.equal((await requests(frame)).length, index);
    await submit(frame, index > 0);
    await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
    const request = (await requests(frame)).at(-1);
    const blocks = [request.messages[0].content].flat();
    assert.match(blocks[0].text, /"项目组"/);
    if (files.includes(word)) assert.match(blocks[0].text, /480 单/);
    if (files.includes(txt)) assert.match(blocks[0].text, /试点覆盖两个业务组/);
    if (files.includes(png)) assert.equal(blocks[1].mimeType, "image/png");
    if (files.includes(jpeg)) assert.equal(blocks[1].mimeType, "image/jpeg");
    for (const item of files) await frame.getByRole("button", { name: "移除 " + item.name }).click();
  }
});

browserCase("multi-file hint follows the three-file threshold without changing pages or requesting Anna",async(page,frame)=>{
 const hint=frame.locator("#multi-file-hint");
 assert.ok(await hint.isHidden());
 await upload(frame,[file("one.txt"),file("two.txt")]);assert.ok(await hint.isHidden());
 await upload(frame,file("three.txt"));assert.ok(await hint.isVisible());
 assert.equal(await hint.textContent(),"本次选择了多个文件，处理时间和积分消耗可能增加。建议根据资料内容合理设置页数，内容较多时建议增加页数到10页以上，防止生成失败。");
 await frame.getByRole("button",{name:"移除 three.txt",exact:true}).click();assert.ok(await hint.isHidden());
 assert.equal(await frame.locator("#page-count").inputValue(),"6");assert.equal((await requests(frame)).length,0);
});

browserCase("M1.4 exposes an accessible picker and one consistent list after choosing or re-choosing", async (page, frame) => {
  const pick = frame.getByRole("button", { name: "选择文件", exact: true });
  const word = file("weekly.docx", wordBuffer);
  await upload(frame, word);
  await frame.locator("#source-list li[data-state=ready]").waitFor();
  assert.equal(await frame.locator("#sources").isVisible(), false, "the native empty-file message must not compete with the source list");
  assert.equal(await pick.isVisible(), true);
  assert.equal(await frame.getByText("weekly.docx", { exact: true }).count(), 1);
  await frame.getByRole("button", { name: "移除 weekly.docx" }).click();
  assert.equal(await frame.locator("#source-list").isVisible(), false);
  await pick.focus();
  const dialog = page.waitForEvent("filechooser", { timeout: 5000 });
  await pick.press("Enter");
  await (await dialog).setFiles(word);
  await expandSources(frame);
  await frame.locator("#source-list li[data-state=ready]").waitFor();
  assert.equal(await frame.getByText("weekly.docx", { exact: true }).count(), 1);
  assert.equal((await requests(frame)).length, 0);
});

browserCase("M1.5 starts compact, exposes errors, and submits attached sources while collapsed", async (page, frame) => {
  const panel = frame.locator("#source-details");
  const summary = frame.locator("#source-summary");
  const word = file("项目周报.docx", wordBuffer);
  const png = await picture(frame, "png");
  const setFiles = files => frame.locator("#sources").setInputFiles(files);
  const screenshot = async name => {
    if (process.env.BRIEFDECK_EVIDENCE) {
      await page.screenshot({ path: `${process.env.BRIEFDECK_EVIDENCE}/${name}.png`, fullPage: true });
    }
  };
  assert.equal(await panel.isVisible(), false);
  await setFiles([word, png]);
  await summary.filter({ hasText: /^已添加 2 个文件$/ }).waitFor();
  assert.equal(await panel.getAttribute("open"), null);
  assert.equal(await frame.getByText(word.name, { exact: true }).isVisible(), false);
  await screenshot("06-sources-collapsed");
  await summary.press("Enter");
  assert.equal(await frame.getByText(word.name, { exact: true }).isVisible(), true);
  assert.equal(await frame.getByText(png.name, { exact: true }).isVisible(), true);
  await frame.getByText("查看提取文字").click();
  assert.match(await frame.locator("#source-list details p").innerText(), /480 单/);
  await screenshot("07-sources-expanded");
  await summary.press("Enter");
  assert.equal(await panel.getAttribute("open"), null);
  await setFiles(file("附件.pdf"));
  await summary.filter({ hasText: /3 个文件.*1 个需处理/ }).waitFor();
  assert.notEqual(await panel.getAttribute("open"), null);
  assert.equal(await frame.getByText("附件.pdf", { exact: true }).isVisible(), true);
  await screenshot("08-sources-error");
  await frame.getByRole("button", { name: "移除 附件.pdf" }).click();
  await summary.filter({ hasText: /^已添加 2 个文件$/ }).waitFor();
  await summary.press("Enter");
  assert.equal(await panel.getAttribute("open"), null);
  assert.equal((await requests(frame)).length, 0);
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  const [request] = await requests(frame);
  assert.match(request.messages[0].content[0].text, /项目周报\.docx.*480 单/);
  assert.equal(request.messages[0].content[1].mimeType, "image/png");
  await summary.press("Enter");
  for (const attachment of [word, png]) {
    await frame.getByRole("button", { name: "移除 " + attachment.name }).click();
  }
  assert.equal(await panel.isVisible(), false);
});

browserCase("M1.3 reports invalid page counts at the field before Generate", async (page, frame) => {
  const field = frame.locator("#page-count");
  const error = frame.locator("#page-count-error");
  const screenshot = async name => {
    if (process.env.BRIEFDECK_EVIDENCE) {
      await page.screenshot({ path: `${process.env.BRIEFDECK_EVIDENCE}/${name}.png`, fullPage: true });
    }
  };
  assert.equal(await field.inputValue(), "6");
  await field.fill("4.5");
  assert.equal(await field.inputValue(), "6", "the decimal should not stay in the input");
  await error.filter({ hasText: /只能输入/ }).waitFor();
  assert.equal(await field.getAttribute("aria-invalid"), "true");
  await screenshot("09-page-format-inline");
  await field.fill("9");
  assert.equal(await error.isVisible(), false);
  for (const text of ["-3", "-4", "1e1", "abc"]) {
    await field.fill(text);
    assert.equal(await field.inputValue(), "9");
    await error.filter({ hasText: /只能输入/ }).waitFor();
  }
  for (const key of [".", "-", "a"]) {
    await field.press(key);
    assert.equal(await field.inputValue(), "9");
    await error.filter({ hasText: /只能输入/ }).waitFor();
  }
  for (const [value, message] of [["", /请输入页数/], ["3", /4–12/], ["13", /4–12/]]) {
    await field.fill(value);
    await error.filter({ hasText: message }).waitFor();
    assert.equal(await field.getAttribute("aria-invalid"), "true");
  }
  await screenshot("10-page-range-inline");
  assert.equal((await requests(frame)).length, 0);
  await submit(frame);
  assert.equal((await requests(frame)).length, 0);
  assert.equal(await field.evaluate(el => document.activeElement === el), true);
  await field.fill("1");
  await error.filter({ hasText: /4–12/ }).waitFor();
  await field.press("End");
  await field.press("2");
  assert.equal(await field.inputValue(), "12");
  assert.equal(await error.isVisible(), false);
  assert.doesNotMatch(await status(frame).innerText(), /整数页数|请输入页数|请输入 4–12/);
  for (const count of ["4", "5", "9", "12"]) {
    await field.fill(count);
    assert.equal(await error.isVisible(), false);
    assert.equal(await field.getAttribute("aria-invalid"), "false");
  }
  await screenshot("11-page-valid-recovery");
});

browserCase("M1.2 and M1.3 block invalid material, over-limit files, and invalid page counts", async (page, frame) => {
  assert.equal(await frame.locator("#page-count").inputValue(), "6");
  await submit(frame);
  await status(frame).filter({ hasText: /至少一份资料/ }).waitFor();
  await frame.locator("#notes").fill("项目摘要");
  for (const count of ["", "4.5", "3", "13"]) {
    await frame.locator("#page-count").fill(count);
    await submit(frame);
    await frame.locator("#page-count-error").waitFor();
  }
  await frame.locator("#page-count").fill("5");
  const invalid = [
    [file("bad.docx"), /无法读取 Word/], [file("empty.txt", Buffer.alloc(0)), /文件为空/],
    [file("broken.png"), /图片内容与格式不符/], [file("test.csv"), /支持 DOCX/],
    [file("large.txt", Buffer.alloc(5 * 1024 * 1024 + 1)), /不能超过 5 MB/]
  ];
  await upload(frame, file("ok.txt"));
  await frame.getByText(/已提取/).waitFor();
  for (const [item, error] of invalid) {
    await upload(frame, item);
    await frame.locator("#source-list li").filter({ hasText: item.name }).getByText(error).waitFor();
    await submit(frame);
    await status(frame).filter({ hasText: /先移除/ }).waitFor();
    await frame.getByRole("button", { name: "移除 " + item.name }).click();
    assert.equal(await frame.getByText("ok.txt", { exact: true }).count(), 1);
  }
  await upload(frame, [file("second.txt"), file("third.txt")]);
  await frame.getByText("最多添加 2 份文档。", { exact: true }).waitFor();
  await frame.getByRole("button", { name: "移除 third.txt" }).click();
  await frame.locator("#notes").fill("字".repeat(6001));
  await submit(frame);
  await status(frame).filter({ hasText: /资料文字超过上限/ }).waitFor();
  assert.equal((await requests(frame)).length, 0);
  await frame.locator("#notes").fill("");
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 5 页/ }).waitFor();
});

async function pdfFixture(name) {
  const data = await readFile(new URL(`./fixtures/pdf/${name}`, import.meta.url));
  return file(name, data, "application/pdf");
}

browserCase("M8.1 reads Chinese PDF pages and reuses the single mixed-source generation request", async (page, frame) => {
  const chinese = await pdfFixture("chinese.pdf");
  const png = await picture(frame, "png");
  await upload(frame, [chinese, file("weekly.docx", wordBuffer), png]);
  const pdf = frame.locator("#source-list li").filter({ hasText: "chinese.pdf" });
  await frame.locator("#source-list li:not([data-state=reading])").filter({ hasText: "chinese.pdf" }).waitFor({ state: "attached" });
  assert.match(await pdf.textContent(), /已提取/);
  if (await frame.locator("#source-details").getAttribute("open") === null) await frame.locator("#source-summary").click();
  await pdf.getByText("查看提取文字").click();
  const extracted = await pdf.locator("details p").textContent();
  assert.match(extracted, /第 1 页\n项目一：分流试点\n客服工单共计 480 单\n首次响应由 18 分钟降至 11 分钟\n\n第 2 页\n项目二：夜班复核\n抽样覆盖 100%，扩容待决策/);
  assert.equal((await requests(frame)).length, 0);
  if (process.env.BRIEFDECK_M8_EVIDENCE) {
    await page.screenshot({ path: `${process.env.BRIEFDECK_M8_EVIDENCE}/01-pdf-preview.png`, fullPage: true });
  }
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  let calls = await requests(frame);
  assert.equal(calls.length, 1);
  let payload = calls[0].messages[0].content;
  let input = JSON.parse(payload[0].text.split("\n").at(-1));
  assert.deepEqual(input.documents.map(item => item.name), ["chinese.pdf", "weekly.docx"]);
  assert.equal(input.documents[0].text, extracted);
  assert.equal(payload[1].type, "image");
  assert.equal(payload.length, 2);
  await frame.getByRole("button", { name: "移除 weekly.docx" }).click();
  await upload(frame, file("notes.txt", Buffer.from("附加的 TXT 资料")));
  await frame.getByText("查看提取文字", { exact: true }).nth(1).waitFor({ state: "attached" });
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  calls = await requests(frame);
  assert.equal(calls.length, 2);
  payload = calls[1].messages[0].content;
  input = JSON.parse(payload[0].text.split("\n").at(-1));
  assert.deepEqual(input.documents.map(item => item.name), ["chinese.pdf", "notes.txt"]);
  await frame.getByRole("button", { name: "移除 chinese.pdf" }).click();
  assert.equal(await pdf.count(), 0);
});

browserCase("M8.2 distinguishes PDF errors and preserves good pages in mixed PDFs", async (page, frame) => {
  await upload(frame, await pdfFixture("mixed.pdf"));
  await frame.getByText("第 1 页没有可提取的文字，已跳过。").waitFor();
  await frame.getByText("查看提取文字").click();
  assert.match(await frame.locator("#source-list details p").textContent(), /^第 2 页\n第一个有效结论$/);
  const cases = [
    [await pdfFixture("scan.pdf"), /扫描件请先做文字识别/],
    [await pdfFixture("encrypted.pdf"), /PDF 已加密/],
    [file("damaged.pdf"), /无法读取 PDF/],
    [file("large.pdf", Buffer.alloc(5 * 1024 * 1024 + 1)), /不能超过 5 MB/],
    [await pdfFixture("too-many-pages.pdf"), /不能超过 50 页/],
    [await pdfFixture("too-much-text.pdf"), /PDF 提取的文字超过 6,000 字/]
  ];
  for (const [fixture, error] of cases) {
    await upload(frame, fixture);
    const row = frame.locator("#source-list li").filter({ hasText: fixture.name });
    await row.getByText(error).waitFor();
    await submit(frame);
    await status(frame).filter({ hasText: /先移除读取失败/ }).waitFor();
    if (fixture.name === "scan.pdf" && process.env.BRIEFDECK_M8_EVIDENCE) {
      await page.screenshot({ path: `${process.env.BRIEFDECK_M8_EVIDENCE}/02-scan-warning.png`, fullPage: true });
    }
    await row.getByRole("button", { name: `移除 ${fixture.name}` }).click();
  }
  assert.equal((await requests(frame)).length, 0);
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  const [request] = await requests(frame);
  assert.match(request.messages[0].content.text, /第 2 页\\n第一个有效结论/);
});

browserCase("M2.1, M2.2 and M3.2 preserve inputs and draft on cancel and host failures", async (page, frame) => {
  assert.ok(await frame.locator("#download").isDisabled());
  await frame.getByRole("button", { name: "载入示例" }).click();
  await frame.getByRole("button", { name: "第 4 页", exact: true }).click();
  await editSlideText(frame, "要点 1", "编辑后保留");
  await upload(frame, await picture(frame, "png"));
  await frame.getByText("图片已就绪").waitFor();
  assert.equal((await requests(frame)).length, 0);
  await frame.getByRole("button", { name: "载入示例" }).click();
  await frame.getByRole("button", { name: "取消" }).click();
  await submit(frame);
  await frame.getByRole("button", { name: "取消" }).click();
  assert.equal((await requests(frame)).length, 0);
  await frame.evaluate(() => { window.holdMockResponse = true; });
  for (const [index, [outcome, error]] of [
    ["count", /所选的 6 页/], ["cut", /被截断/], ["json", /无法读取的格式/],
    ["quota", /积分不足/], ["vision", /无法读取图片/], ["network", /无法连接 Anna/]
  ].entries()) {
    await frame.evaluate(outcome => { window.mockOutcome = outcome; }, outcome);
    await submit(frame, true);
    await frame.waitForFunction(() => typeof window.releaseMockResponse === "function");
    await frame.evaluate(() => {
      document.querySelector("#brief-form").requestSubmit();
      const release = window.releaseMockResponse;
      window.releaseMockResponse = undefined;
      release();
    });
    await status(frame).filter({ hasText: error }).waitFor();
    assert.equal((await requests(frame)).length, index + 1);
    assert.match(await frame.locator("#stage").innerText(), /编辑后保留/);
    assert.match(await frame.locator("#notes").inputValue(), /480 单/);
    assert.equal(await frame.getByText("chart.png", { exact: true }).count(), 1);
    if (outcome === "cut") {
      const message = await status(frame).innerText();
      assert.match(message, /本次消耗 14.00 积分/);
      assert.doesNotMatch(message, /tokens|模型|CU|输出上限/);
      if (process.env.BRIEFDECK_M2_EVIDENCE) {
        await page.screenshot({ path: `${process.env.BRIEFDECK_M2_EVIDENCE}/03-local-truncation-and-usage.png`, fullPage: true });
      }
    }
  }
});

browserCase("M2.4 applies the same varied templates to the example and simulated generated deck", async (page, frame) => {
  const cases = [[2, "metrics"], [3, "progress"], [4, "risk"], [5, "actions"], [6, "decision"]];
  await frame.getByRole("button", { name: "载入示例" }).click();
  for (const [number, kind] of cases) {
    await frame.getByRole("button", { name: `第 ${number} 页`, exact: true }).click();
    const slide = frame.locator("#stage .slide");
    assert.equal(await slide.getAttribute("data-layout"), kind);
    if (kind === "metrics") {
      for (const value of ["480 单", "18 → 11 分钟", "100%"]) {
        assert.equal(await slide.getByText(value, { exact: true }).count(), 1);
      }
    }
    if (process.env.BRIEFDECK_LAYOUT_EVIDENCE && ["metrics", "risk", "decision"].includes(kind)) {
      await page.screenshot({ path: `${process.env.BRIEFDECK_LAYOUT_EVIDENCE}/example-${kind}.png`, fullPage: true });
    }
  }
  assert.equal((await requests(frame)).length, 0);
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const point = frame.getByRole("button", { name: "编辑要点 2", exact: true });
  const original = await point.boundingBox();
  await frame.evaluate(() => { window.mockOutcome = "composition"; });
  await submit(frame, true);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  assert.match(await status(frame).textContent(), /25\.27 积分/);
  assert.doesNotMatch(await status(frame).textContent(),/tokens|mock-vision|推理|输出上限/);
  for (const [number, kind] of cases) {
    await frame.getByRole("button", { name: `第 ${number} 页`, exact: true }).click();
    assert.equal(await frame.locator("#stage .slide").getAttribute("data-layout"), kind);
  }
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.notDeepEqual(await point.boundingBox(), original);
  assert.equal(await frame.locator("#stage").getByText("18 → 11 分钟", { exact: true }).count(), 1);
  if (process.env.BRIEFDECK_COMPOSITION_EVIDENCE) {
    await frame.locator("#ppt-theme").selectOption("technology");
    await frame.locator("#ppt-color").fill("#d7ab79");
    await page.screenshot({ path: process.env.BRIEFDECK_COMPOSITION_EVIDENCE, fullPage: true });
  }
  const [request] = await requests(frame);
  assert.match(request.messages[0].content.text, /metrics 指标/);
});

async function openMetricFixture(page, frame, raw, name) {
  const deck = parseDeck({ content: { text: JSON.stringify(raw) }, stopReason: "endTurn" }, raw.slides.length);
  deck.slides[0].title = name;
  const record = { id: "metric-fixture", title: name, pageCount: deck.slides.length, updatedAt: Date.now(), style: { theme: "minimal", accent: "" }, deck };
  await frame.evaluate(record => localStorage.setItem("mockAnnaStorage", JSON.stringify({
    "briefdeck/drafts/metric-fixture": { value: record, metadata: { schema: 1, title: record.title, pageCount: record.pageCount, updatedAt: record.updatedAt }, etag: "initial" }
  })), record);
  await page.reload();
  const active = page.frames().find(item => item.parentFrame());
  await active.locator("#library > summary").click();
  await active.getByRole("button", { name: new RegExp(name + ".*" + deck.slides.length + " 页") }).click();
  await active.getByRole("button", { name: "第 2 页", exact: true }).click();
  return active;
}

async function assertMetricBounds(page, frame, label) {
  for (const width of [1200, 480]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(await frame.locator("#stage .slide-text").evaluateAll(items => items.filter(item => item.textContent).every(item => {
      const range = document.createRange(); range.selectNodeContents(item);
      const text = range.getBoundingClientRect(), box = item.getBoundingClientRect();
      return text.left >= box.left - 1 && text.top >= box.top - 1 && text.bottom <= box.bottom + 1 && text.right <= box.right + 1;
    })), `${label} fits ${width}px`);
  }
  await page.setViewportSize({ width: 1200, height: 960 });
}

async function savedMockDraft(frame) {
  await frame.waitForFunction(()=>document.querySelector("#draft-save-state").textContent==="当前 PPT 已保存");
  return frame.evaluate(()=>Object.values(JSON.parse(localStorage.getItem("mockAnnaStorage")))[0].value);
}

async function generateRedesign(frame) {
  await frame.locator("#redesign").click();
  await frame.locator("#redesign-request").click();
  await frame.locator("#redesign-preview").waitFor({state:"visible"});
}

browserCase("P2.5 preview and cancel are isolated; confirmation, undo, P2 and durable reset preserve edited prose and pictures", async (page, initial) => {
  let frame=await openMetricFixture(page,initial,structuredClone(sampleDeck),"单页设计验收");
  await frame.getByRole("button",{name:"封面",exact:true}).click();
  assert.ok(await frame.locator("#redesign").isDisabled());
  await frame.getByRole("button",{name:"第 2 页",exact:true}).click();
  await frame.locator('#stage [data-field="0"]').click();
  const edited="本周处理492单，仅限工作日的两个业务组。";
  await frame.getByRole("textbox",{name:"要点 1编辑框",exact:true}).fill(edited);
  await frame.getByRole("textbox",{name:"要点 1编辑框",exact:true}).press("Enter");
  const image=await picture(frame,"png",58);await frame.locator("#picture-file").setInputFiles(image);
  await frame.locator("#stage .slide-picture canvas").waitFor();
  const before=await savedMockDraft(frame);
  const beforeDOM=await frame.locator("#stage .slide").innerHTML();
  await frame.locator("#redesign").click();
  assert.match(await frame.locator("#redesign-confirm").textContent(),/最多4次.*积分/);
  assert.equal((await requests(frame)).length,0);
  await frame.locator("#redesign-cancel").click();
  assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
  await generateRedesign(frame);
  assert.equal((await requests(frame)).length,1);
  assert.doesNotMatch(await frame.locator("#redesign-progress").textContent(),/tokens|mock-redesign/);
  assert.ok(!await frame.locator("#redesign-detail").evaluate(item=>item.open));
  assert.equal(await frame.locator("#stage .slide").innerHTML(),beforeDOM);
  assert.equal(await frame.locator("#stage .slide-picture canvas").count(),1);
  assert.equal(await frame.locator("#redesign-preview .slide-picture canvas").count(),1);
  for(const width of [1200,480]) {
    await page.setViewportSize({width,height:1000});
    assert.ok(await frame.locator("#redesign-preview .slide-text").evaluateAll(items=>items.filter(item=>item.textContent).every(item=>{
      const r=document.createRange();r.selectNodeContents(item);const text=r.getBoundingClientRect(),box=item.getBoundingClientRect();
      return text.right<=box.right+1&&text.bottom<=box.bottom+1&&text.left>=box.left-1&&text.top>=box.top-1;
    })));
  }
  await page.setViewportSize({width:1200,height:1000});
  if(process.env.BRIEFDECK_P25_EVIDENCE)await frame.locator("#redesign-dialog").screenshot({path:process.env.BRIEFDECK_P25_EVIDENCE+"/01-candidate-preview.png"});
  await frame.locator("#redesign-cancel").click();
  assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
  await generateRedesign(frame);await frame.locator("#redesign-apply").click();
  assert.doesNotMatch(await frame.locator("#redesign-status").textContent(),/tokens|mock-redesign/);
  const attempt=JSON.parse(await frame.locator("#rendering-output").textContent()).latestSinglePageAttempt;
  assert.equal(attempt.status,"applied");assert.equal(attempt.model,"mock-redesign");assert.equal(attempt.usage.outputTokens,180);
  let saved=await savedMockDraft(frame);
  assert.equal(saved.deck.slides[1].manualLayout,"ai-design");
  assert.deepEqual(saved.deck.slides[1].points,before.deck.slides[1].points);
  assert.deepEqual(saved.deck.slides[1].pictures,before.deck.slides[1].pictures);
  for(const index of [0,2,3,4,5])assert.deepEqual(saved.deck.slides[index],before.deck.slides[index]);
  const controls=frame.locator("#layout-controls");await controls.locator("summary").click();
  await controls.getByRole("button",{name:"撤销上次切换"}).click();
  assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
  await generateRedesign(frame);await frame.locator("#redesign-apply").click();await savedMockDraft(frame);
  if(!await controls.locator("#layout-options").isVisible())await controls.locator("summary").click();
  await controls.getByRole("button",{name:"简洁文字",exact:true}).click();
  await controls.getByRole("button",{name:"AI设计",exact:true}).click();
  await assertMetricBounds(page,frame,"confirmed AI grid");
  if(process.env.BRIEFDECK_P25_EVIDENCE)await frame.locator(".editor").screenshot({path:process.env.BRIEFDECK_P25_EVIDENCE+"/02-applied.png"});
  const downloading=page.waitForEvent("download");await frame.locator("#download").click();const file=await downloading;
  if(process.env.BRIEFDECK_P25_OUTPUT) {
    await file.saveAs(process.env.BRIEFDECK_P25_OUTPUT+"/confirmed.pptx");
    await writeFile(process.env.BRIEFDECK_P25_OUTPUT+"/source.json",JSON.stringify(before.deck));
  }
  const zip=await JSZip.loadAsync(await readFile(await file.path()));
  const xml=await zip.file("ppt/slides/slide2.xml").async("string");
  const text=[...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map(item=>item[1]).join("");
  assert.ok(text.includes(edited));assert.equal([...xml.matchAll(/<p:pic>/g)].length,1);assert.match(xml,/<p:sp>/);
  const calls=await requests(frame);assert.equal(calls.length,3);
  assert.ok(calls.every(request=>request.maxTokens===900));
  assert.ok(calls.every(request=>!request.messages[0].content.text.includes(image.buffer.toString("base64"))));
  await savedMockDraft(frame);await page.reload();frame=page.frames().find(item=>item.parentFrame());
  await frame.locator("#library > summary").click();await frame.getByRole("button",{name:/单页设计验收.*6 页/}).click();
  await frame.getByRole("button",{name:"第 2 页",exact:true}).click();
  assert.equal((await savedMockDraft(frame)).deck.slides[1].manualLayout,"ai-design");
  assert.ok((await frame.locator('#stage [data-field="0"]').textContent()).replaceAll("\n","").includes(edited));
  await frame.locator("#layout-controls > summary").click();
  await frame.getByRole("button",{name:"恢复原布局",exact:true}).click();
  assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
  assert.equal((await requests(frame)).length,0);
});

browserCase("P2.5 invalid, identical and failed candidates leave the draft untouched and never retry", async (page,initial)=>{
  const frame=await openMetricFixture(page,initial,structuredClone(sampleDeck),"失败不改稿验收");
  const controls=frame.locator("#layout-controls");await controls.locator("summary").click();
  await controls.getByRole("button",{name:"简洁文字",exact:true}).click();
  const before=await savedMockDraft(frame);
  for(const outcome of ["unsafe","network","cut","same"]) {
    await frame.evaluate(outcome=>{window.mockRedesignOutcome=outcome;},outcome);
    await frame.locator("#redesign").click();await frame.locator("#redesign-request").click();
    await frame.locator("#redesign-progress").filter({hasText:/暂未找到符合当前页面要求/}).waitFor();
    assert.ok(await frame.locator("#redesign-apply").isHidden());
    assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
    assert.equal(await frame.evaluate(()=>window.executed),undefined);
    if(outcome==="unsafe"&&process.env.BRIEFDECK_P25_EVIDENCE)await frame.locator("#redesign-dialog").screenshot({path:process.env.BRIEFDECK_P25_EVIDENCE+"/03-invalid.png"});
    await frame.locator("#redesign-cancel").click();
  }
  assert.equal((await requests(frame)).length,10);
});

browserCase("P2.5 cancellation discards a late response and a changed style invalidates the preview",async(page,initial)=>{
  const frame=await openMetricFixture(page,initial,structuredClone(sampleDeck),"迟到候选验收");
  const before=await savedMockDraft(frame);
  await frame.evaluate(()=>{window.holdRedesignResponse=true;});
  await frame.locator("#redesign").click();await frame.locator("#redesign-request").click();
  await frame.waitForFunction(()=>typeof window.releaseRedesignResponse==="function");
  await frame.locator("#redesign-cancel").click();
  assert.ok(await frame.locator("#redesign").isDisabled());
  await frame.getByRole("button",{name:"第 3 页",exact:true}).click();
  await frame.evaluate(()=>{window.holdRedesignResponse=false;window.releaseRedesignResponse();});
  await frame.locator("#redesign").waitFor({state:"visible"});
  await frame.waitForFunction(()=>!document.querySelector("#redesign").disabled);
  assert.ok(!await frame.locator("#redesign-dialog").evaluate(dialog=>dialog.open));
  assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
  await frame.getByRole("button",{name:"第 2 页",exact:true}).click();
  await generateRedesign(frame);
  await frame.evaluate(()=>{const theme=document.querySelector("#ppt-theme");theme.value="technology";theme.dispatchEvent(new Event("change"));});
  await frame.locator("#redesign-apply").click();
  await frame.locator("#redesign-progress").filter({hasText:/已变化/}).waitFor();
  assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
  await frame.locator("#redesign-cancel").click();
  assert.equal((await requests(frame)).length,2);
});

browserCase("P2.5 source-edited metrics may be redesigned as text without reviving stale charts",async(page,initial)=>{
  const frame=await openMetricFixture(page,initial,metricExamples()[0].raw,"失效指标单页设计验收");
  await frame.locator('#stage [data-field="0"]').click();
  const changed="当前已调整统计口径，响应时间改为12分钟。";
  const input=frame.getByRole("textbox",{name:"要点 1编辑框",exact:true});await input.fill(changed);await input.press("Enter");
  await frame.evaluate(()=>{window.mockRedesignRaw={design:[[0,"focus",0,0,6,11],[1,"text",6,0,6,11]]};});
  await generateRedesign(frame);await frame.locator("#redesign-apply").click();
  const saved=await savedMockDraft(frame);
  assert.equal(saved.deck.slides[1].metricInvalidated,true);
  assert.equal(saved.deck.slides[1].points[0],changed);
  assert.equal(saved.deck.slides[1].manualLayout,"ai-design");
  assert.equal(await frame.locator("#stage [data-metric-part]").count(),0);
  assert.equal((await frame.locator('#stage [data-field="0"]').textContent()).replaceAll("\n",""),changed);
  const controls=frame.locator("#layout-controls");await controls.locator("summary").click();
  await controls.getByRole("button",{name:"撤销上次切换"}).click();
  assert.equal(await frame.locator("#stage [data-metric-part]").count(),0);
  assert.equal((await savedMockDraft(frame)).deck.slides[1].points[0],changed);
  assert.equal((await requests(frame)).length,1);
});

browserCase("P2.5 controlled corrections succeed on calls one through four and display only the exact total credits",async(page,initial)=>{
 let frame=initial;
 const bad={design:[[0,"text",0,0,4,4],[1,"text",4,0,4,5],[2,"text",8,0,4,5]]};
 const good={design:[[0,"focus",0,0,6,11],[1,"text",6,0,6,5],[2,"text",6,6,6,5]]};
 for(const success of [1,2,3,4]) {
  frame=await openMetricFixture(page,frame,structuredClone(sampleDeck),`受控纠错${success}`);
  await frame.evaluate(({success,bad,good})=>{window.mockRedesignSequence=Array.from({length:success},(_,i)=>({cost:(i+1)/10,...(i===success-1?(success===4?{alternative:true}:{raw:good}):{raw:bad})}));},{success,bad,good});
  const before=await savedMockDraft(frame);
  await generateRedesign(frame);
  assert.equal((await requests(frame)).length,success);
  assert.match(await frame.locator("#redesign-progress").textContent(),new RegExp(`本次消耗 ${["0.10","0.30","0.60","1.00"][success-1]} 积分`));
  assert.doesNotMatch(await frame.locator("#redesign-progress").textContent(),/tokens|mock-redesign|第.*次尝试|网格/);
  const report=await frame.evaluate(()=>window.briefdeckDiagnostics());
  assert.equal(report.latestSinglePageAttempt.attempts.length,success);
  assert.equal(report.latestSinglePageAttempt.status,"candidate");
  if(success>1)assert.match(report.latestSinglePageAttempt.attempts[0].error,/高度4小于最小5/);
  if(success===4){const calls=await requests(frame);const payload=JSON.parse(calls[3].messages[0].content.text.split("\n").at(-1));assert.equal(payload.correction.failedAttempts.length,3);assert.equal(payload.correction.alternativeOnly,true);}
  if(success===4 && process.env.BRIEFDECK_CORRECTION_EVIDENCE)await frame.locator("#redesign-dialog").screenshot({path:process.env.BRIEFDECK_CORRECTION_EVIDENCE+"/02-total-credits.png"});
  assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
  if(success===4) {
    await frame.locator("#redesign-apply").click();
    const saved=await savedMockDraft(frame);
    assert.equal(saved.deck.slides[1].redesignTrace.attempts.length,4);
    assert.equal(saved.deck.slides[1].redesignTrace.credits.total,"1");
    assert.deepEqual(saved.deck.slides[1].points,before.deck.slides[1].points);
    for(const index of [0,2,3,4,5])assert.deepEqual(saved.deck.slides[index],before.deck.slides[index]);
    await frame.locator("#layout-controls > summary").click();
    await frame.getByRole("button",{name:"撤销上次切换",exact:true}).click();
    assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
  } else await frame.locator("#redesign-cancel").click();
 }
});

browserCase("P2.5 four failures remain failed after closing; late cancellation records every received credit without another call",async(page,initial)=>{
 let frame=await openMetricFixture(page,initial,structuredClone(sampleDeck),"失败及取消积分验收");
 const bad={design:[[0,"text",0,0,4,4],[1,"text",4,0,4,5],[2,"text",8,0,4,5]]};
 await frame.evaluate(bad=>{window.mockRedesignSequence=Array.from({length:4},()=>({raw:bad,cost:0.1}));},bad);
 const before=await savedMockDraft(frame);
 await frame.locator("#redesign").click();await frame.locator("#redesign-request").click();
 await frame.locator("#redesign-progress").filter({hasText:/暂未找到符合当前页面要求/}).waitFor();
 assert.match(await frame.locator("#redesign-progress").textContent(),/0.40 积分/);
 assert.equal((await requests(frame)).length,4);
 if(process.env.BRIEFDECK_CORRECTION_EVIDENCE)await frame.locator("#redesign-dialog").screenshot({path:process.env.BRIEFDECK_CORRECTION_EVIDENCE+"/03-failure.png"});
 await frame.locator("#redesign-cancel").click();
 assert.equal((await frame.evaluate(()=>window.briefdeckDiagnostics())).latestSinglePageAttempt.status,"failed");
 assert.deepEqual((await savedMockDraft(frame)).deck,before.deck);
 frame=await openMetricFixture(page,frame,structuredClone(sampleDeck),"迟到积分验收");
 await frame.evaluate(bad=>{window.holdRedesignResponse=true;window.mockRedesignSequence=[{raw:bad,cost:0.2}];},bad);
 await frame.locator("#redesign").click();await frame.locator("#redesign-request").click();
 await frame.waitForFunction(()=>typeof window.releaseRedesignResponse==="function");
 await frame.locator("#redesign-cancel").click();await frame.getByRole("button",{name:"第 3 页",exact:true}).click();
 await frame.evaluate(()=>window.releaseRedesignResponse());
 await frame.waitForFunction(()=>!document.querySelector("#redesign").disabled);
 const report=await frame.evaluate(()=>window.briefdeckDiagnostics());
 assert.equal(report.latestSinglePageAttempt.status,"cancelled");
 assert.equal(report.latestSinglePageAttempt.credits.total,"0.2");
 assert.equal((await requests(frame)).length,1);
 assert.match(await frame.locator("#redesign-status").textContent(),/0.20 积分/);
});

browserCase("whole-deck controlled truncation retry totals credits; cancellation discards late output and preserves draft",async(page,frame)=>{
 await frame.locator("#notes").fill("完整事实与限定条件");
 await frame.evaluate(()=>{window.mockOutcome="truncated-once";});
 await submit(frame);
 await status(frame).filter({hasText:/已生成 6 页/}).waitFor();
 assert.match(await status(frame).textContent(),/0.21 积分/);
 assert.doesNotMatch(await status(frame).textContent(),/模型|tokens|输出上限/);
 const sent=await requests(frame);assert.equal(sent.length,2);assert.ok(sent[1].maxTokens>sent[0].maxTokens);
 const saved=await savedMockDraft(frame);
 assert.equal(saved.deck.generationTrace.credits.total,"0.208");
 assert.equal(saved.deck.generationTrace.attempts.length,2);
 const before=await frame.evaluate(()=>JSON.parse(localStorage.getItem("mockAnnaStorage")));
 assert.equal((await frame.evaluate(()=>window.briefdeckDiagnostics())).generationOperation.credits.total,"0.208");
 await frame.evaluate(()=>{window.holdMockResponse=true;window.fullCallCount=0;});
 await submit(frame);
 await frame.waitForFunction(()=>typeof window.releaseMockResponse==="function");
 await frame.locator("#cancel-generation").click();
 await frame.evaluate(()=>{window.releaseMockResponse();});
 await status(frame).filter({hasText:/已取消生成.*0.10 积分/}).waitFor();
 assert.equal((await requests(frame)).length,3);
 assert.deepEqual(await frame.evaluate(()=>JSON.parse(localStorage.getItem("mockAnnaStorage"))),before);
 assert.equal((await frame.evaluate(()=>window.briefdeckDiagnostics())).generationOperation.status,"cancelled");
});

browserCase("ordinary UI hides diagnostics and exposes credits only for both full generation and single-page design",async(page,initial)=>{
 await page.goto(origin+"/?public=1");
 let frame=page.frames().find(item=>item.parentFrame());
 frame=await openMetricFixture(page,frame,structuredClone(sampleDeck),"普通界面积分验收");
 assert.ok(await frame.locator("#rendering-diagnostic").isHidden());
 await generateRedesign(frame);
 assert.ok(await frame.locator("#redesign-detail").isHidden());
 assert.match(await frame.locator("#redesign-progress").textContent(),/0.00 积分/);
 assert.doesNotMatch(await frame.locator("body").innerText(),/mock-redesign|tokens|输出上限|布局诊断日志/);
 if(process.env.BRIEFDECK_CORRECTION_EVIDENCE)await frame.locator("#redesign-dialog").screenshot({path:process.env.BRIEFDECK_CORRECTION_EVIDENCE+"/01-public-preview.png"});
 await frame.locator("#redesign-apply").click();await savedMockDraft(frame);
 await frame.locator("#notes").fill("普通用户用量显示回归");
 await frame.evaluate(()=>{window.mockOutcome="composition";});await submit(frame);
 await status(frame).filter({hasText:/已生成 6 页/}).waitFor();
 assert.match(await status(frame).textContent(),/25.27 积分/);
 assert.doesNotMatch(await status(frame).textContent(),/mock-vision|tokens|输出上限|推理/);
 assert.ok(await frame.locator("#rendering-diagnostic").isHidden());
 assert.equal(typeof await frame.evaluate(()=>window.briefdeckDiagnostics()),"object");
});

async function metricScreenshot(frame, name) {
  if (process.env.BRIEFDECK_V1_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_V1_EVIDENCE}/${name}.png` });
}

async function metricDownload(page, frame, name) {
  const download = page.waitForEvent("download");
  await frame.locator("#download").click();
  const file = await download;
  if (process.env.BRIEFDECK_V1_OUTPUT) await file.saveAs(`${process.env.BRIEFDECK_V1_OUTPUT}/${name}.pptx`);
  return JSZip.loadAsync(await readFile(await file.path()));
}

browserCase("V1 relation fixtures preserve real source text, use proportional graphics, switch layouts and restore without Anna", async (page, initial) => {
  let frame = initial;
  for (const { name, raw } of metricExamples()) {
    frame = await openMetricFixture(page, frame, raw, `指标验收-${name}`);
    const canvas = frame.locator("#stage");
    const controls = frame.locator("#layout-controls");
    const sourcePoints = raw.slides[1].points;
    const isCompletion = name === "completion";
    const fill = canvas.locator(isCompletion ? '[data-metric-part="progress-fill"]' : '[data-metric-part="bar-1"]');
    await fill.waitFor();
    if (isCompletion) {
      assert.equal(await canvas.getByText("完成率 80%", { exact: true }).count(), 1);
      assert.equal(await canvas.getByText("9,600 / 12,000 份", { exact: true }).count(), 1);
      assert.ok(Math.abs((await fill.boundingBox()).width / (await canvas.locator('[data-metric-part="progress-track"]').boundingBox()).width - 0.8) < 0.001);
    } else {
      const expected = name === "customer" ? 11 / 18 : 2 / 8;
      assert.ok(Math.abs((await fill.boundingBox()).width / (await canvas.locator('[data-metric-part="bar-0"]').boundingBox()).width - expected) < 0.001);
    }
    for (const point of sourcePoints) assert.ok((await canvas.innerText()).replaceAll("\n", "").includes(point));
    await assertMetricBounds(page, frame, name);
    await controls.locator("summary").click();
    assert.deepEqual(await controls.locator(".layout-choice strong").allTextContents(), ["数据关系可视化", "并列展示", "简洁文字"]);
    for (const option of ["并列展示", "简洁文字"]) {
      await controls.getByRole("button", { name: option, exact: true }).click();
      assert.equal(await canvas.locator("[data-metric-part]").count(), 0);
      for (const point of sourcePoints) assert.ok((await canvas.innerText()).replaceAll("\n", "").includes(point));
    }
    await controls.getByRole("button", { name: "撤销上次切换" }).click();
    assert.equal(await controls.getByRole("button", { name: "并列展示", exact: true }).getAttribute("aria-pressed"), "true");
    await controls.getByRole("button", { name: "恢复原布局" }).click();
    await fill.waitFor();
    await controls.getByRole("button", { name: "简洁文字", exact: true }).click();
    await controls.getByRole("button", { name: "数据关系可视化", exact: true }).click();
    await metricScreenshot(frame, `01-${name}`);
    const native = await metricDownload(page, frame, name);
    const xml = await native.file("ppt/slides/slide2.xml").async("string");
    assert.match(xml, /<p:sp>/);
    assert.doesNotMatch(xml, /<p:pic>/);
    await frame.locator("#library > summary").click();
    await frame.getByText("当前 PPT 已保存", { exact: true }).waitFor();
    const stored = await frame.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mockAnnaStorage")))[0].value);
    assert.deepEqual(stored.deck.slides[1].points, sourcePoints);
    assert.equal(stored.deck.slides[1].metric.sourceText, sourcePoints[0]);
    assert.equal((await requests(frame)).length, 0);
    await page.reload();
    frame = page.frames().find(item => item.parentFrame());
    await frame.locator("#library > summary").click();
    await frame.getByRole("button", { name: new RegExp(`指标验收-${name}.*6 页`) }).click();
    await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
    assert.ok(await frame.locator('#stage [data-metric-part]').count() > 0);
    assert.equal((await requests(frame)).length, 0);
  }
});

browserCase("V1 editing the source rebuilds safely, preserves pictures and cannot revive stale calculations", async (page, initial) => {
  const frame = await openMetricFixture(page, initial, metricExamples()[2].raw, "指标失效验收");
  const canvas = frame.locator("#stage");
  const controls = frame.locator("#layout-controls");
  await editSlideText(frame, "标题", "档案迁移阶段复盘");
  await editSlideText(frame, "要点 2", "完整性校验通过率99.2%，目标99.5%，36名员工参与试用。");
  assert.ok(await canvas.locator('[data-metric-part="progress-fill"]').isVisible());
  const source = canvas.getByRole("button", { name: "编辑要点 1", exact: true });
  await source.click();
  const input = canvas.getByRole("textbox", { name: "要点 1编辑框", exact: true });
  await input.fill("取消的修改，不应使原指标失效。");
  await input.press("Escape");
  assert.ok(await canvas.locator('[data-metric-part="progress-fill"]').isVisible());
  const pictureFile = await picture(frame, "png", 58);
  await frame.locator("#picture-file").setInputFiles(pictureFile);
  const figure = canvas.getByRole("group", { name: pictureFile.name });
  await figure.waitFor();
  await figure.focus();
  await figure.press("ArrowLeft");
  const placement = await figure.getAttribute("style");
  await controls.locator("summary").click();
  await controls.getByRole("button", { name: "简洁文字", exact: true }).click();
  await controls.getByRole("button", { name: "数据关系可视化", exact: true }).click();
  await source.click();
  const edited = "仅统计工作日，已完成9,000份，计划12,000份。";
  await input.fill(edited);
  // Switching to another editor commits the source and rebuilds the relation component.
  await canvas.getByRole("button", { name: "编辑要点 2", exact: true }).click();
  await canvas.getByRole("textbox", { name: "要点 2编辑框", exact: true }).waitFor();
  await canvas.getByRole("textbox", { name: "要点 2编辑框", exact: true }).press("Escape");
  assert.equal(await canvas.locator("[data-metric-part]").count(), 0);
  assert.ok((await canvas.innerText()).replaceAll("\n", "").includes(edited));
  assert.doesNotMatch(await canvas.innerText(), /完成率 80%|9,600|剩余 2,400/);
  assert.ok(await controls.isHidden());
  assert.match(await frame.locator("#metric-status").innerText(), /停用数据图/);
  assert.equal(await figure.getAttribute("style"), placement);
  await figure.focus();
  await figure.press("ArrowLeft");
  assert.notEqual(await figure.getAttribute("style"), placement);
  await metricScreenshot(frame, "02-source-invalidated");
  const zip = await metricDownload(page, frame, "edited-invalidated");
  const xml = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.match(xml, /9,000份/);
  assert.doesNotMatch(xml, /9,600|完成率 80%/);
  assert.match(xml, /<p:pic>/);
  await frame.locator("#library > summary").click();
  await frame.getByText("当前 PPT 已保存", { exact: true }).waitFor();
  const saved = await frame.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mockAnnaStorage")))[0].value);
  assert.equal(saved.deck.slides[1].metricInvalidated, true);
  assert.equal(saved.deck.slides[1].metric, undefined);
  assert.equal((await requests(frame)).length, 0);
  await page.reload();
  const restored = page.frames().find(item => item.parentFrame());
  await restored.locator("#library > summary").click();
  await restored.getByRole("button", { name: /指标失效验收.*6 页/ }).click();
  await restored.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await restored.locator("#stage [data-metric-part]").count(), 0);
  assert.ok(await restored.locator("#metric-status").isVisible());
  assert.equal((await requests(restored)).length, 0);
});

browserCase("V1 zero baseline, over-completion and invalid relations remain explicit and export safely", async (page, initial) => {
  let frame = initial;
  const cases = [
    ["zero", "耗时从0分钟变为2分钟。", { kind: "comparison", point: 0, label: "耗时", unit: "分钟", values: ["0分钟", "2分钟"] }, "基线为 0，不计算相对变化"],
    ["over", "已完成15份，计划12份，完成率125%。", { kind: "completion", point: 0, label: "已完成", unit: "份", values: ["15份", "12份"], rate: "125%" }, "超出总量 3 份"],
    ["zero-total", "已完成0份，计划0份。", { kind: "completion", point: 0, label: "已完成", unit: "份", values: ["0份", "0份"] }],
    ["mixed-unit", "耗时从8分钟变为2小时。", { kind: "comparison", point: 0, label: "耗时", unit: "分钟", values: ["8分钟", "2小时"] }]
  ];
  for (const [name, point, metric, expected] of cases) {
    frame = await openMetricFixture(page, frame, edgeMetricDeck(point, metric), `边界验收-${name}`);
    const canvas = frame.locator("#stage");
    if (expected) assert.ok((await canvas.innerText()).includes(expected));
    else assert.equal(await canvas.locator("[data-metric-part]").count(), 0);
    assert.ok((await canvas.innerText()).includes(point));
    assert.doesNotMatch(await canvas.innerText(), /NaN|Infinity/);
    await assertMetricBounds(page, frame, name);
    await metricScreenshot(frame, `03-${name}`);
    await metricDownload(page, frame, name);
    assert.equal((await requests(frame)).length, 0);
  }
});

browserCase("V1 cross-page components keep narrative priority, offer only compatible P2 choices and export", async (page, initial) => {
  let frame = initial;
  for (const { name, raw } of [{ name: "metrics", raw: metricExamples()[0].raw }, ...crossPageExamples()]) {
    frame = await openMetricFixture(page, frame, raw, `跨页验收-${name}`);
    const canvas = frame.locator("#stage");
    const controls = frame.locator("#layout-controls");
    const compatible = !["ordinary", "ordinal"].includes(name);
    if (compatible) {
      assert.ok(name === "summary" ? await canvas.getByText("人工复核覆盖率：100%", { exact: true }).count() > 0 : await canvas.locator("[data-metric-part]").count() > 0);
      await controls.locator("summary").click();
      if (name !== "metrics") {
        const choice = name === "summary" ? "核心数值辅助" : "数据关系辅助";
        assert.deepEqual(await controls.locator(".layout-choice strong").allTextContents(), [choice, "原有叙事布局"]);
        const primary = name === "risk" ? 0 : name === "decision" ? 1 : undefined;
        const narrativeBefore = primary === undefined ? undefined : await canvas.locator(`[data-field="${primary}"]`).getAttribute("style");
        await controls.getByRole("button", { name: "原有叙事布局", exact: true }).click();
        assert.equal(await canvas.locator("[data-metric-part]").count(), 0);
        if (primary !== undefined) assert.equal(await canvas.locator(`[data-field="${primary}"]`).getAttribute("style"), narrativeBefore);
        await controls.getByRole("button", { name: "撤销上次切换" }).click();
        await controls.getByRole("button", { name: choice, exact: true }).click();
        if (primary !== undefined) assert.equal(await canvas.locator(`[data-field="${primary}"]`).getAttribute("style"), narrativeBefore);
        await controls.getByRole("button", { name: "原有叙事布局", exact: true }).click();
        await controls.getByRole("button", { name: "恢复原布局" }).click();
      }
      if (name === "risk") {
        assert.equal(await canvas.getByText("低于目标 3 个百分点", { exact: true }).count(), 1);
        assert.equal(await canvas.getByText("当前 92%", { exact: true }).count(), 1);
        assert.equal(await canvas.getByText("目标 95%", { exact: true }).count(), 1);
        assert.doesNotMatch(await canvas.innerText(), /之前|之后|缩短|增加约/);
      }
    } else {
      assert.equal(await canvas.locator("[data-metric-part]").count(), 0);
      assert.equal(await controls.getByRole("button", { name: /数据关系/ }).count(), 0);
    }
    for (const point of raw.slides[1].points) assert.ok((await canvas.innerText()).replaceAll("\n", "").includes(point.replace(/^当前建议[：:]\s*/, "")));
    await assertMetricBounds(page, frame, `cross-page ${name}`);
    if (process.env.BRIEFDECK_CROSS_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_CROSS_EVIDENCE}/01-${name}.png` });
    const downloading = page.waitForEvent("download");
    await frame.locator("#download").click();
    const file = await downloading;
    if (process.env.BRIEFDECK_CROSS_OUTPUT) await file.saveAs(`${process.env.BRIEFDECK_CROSS_OUTPUT}/${name}.pptx`);
    assert.equal((await requests(frame)).length, 0);
  }
});

browserCase("V1 non-metrics source edits disable the component while preserving the main risk", async (page, initial) => {
  const raw = crossPageExamples().find(item => item.name === "risk").raw;
  const frame = await openMetricFixture(page, initial, raw, "风险页编辑验收");
  const canvas = frame.locator("#stage");
  const primaryStyle = await canvas.locator('[data-field="0"]').getAttribute("style");
  await editSlideText(frame, "要点 2", "准确率91%，目标95%，需要继续复核。");
  assert.equal(await canvas.locator("[data-metric-part]").count(), 0);
  assert.equal(await canvas.locator('[data-field="0"]').getAttribute("style"), primaryStyle);
  assert.match((await canvas.innerText()).replaceAll("\n", ""), /复杂工单分类仍不稳定，暂不全面推广/);
  assert.match(await frame.locator("#metric-status").innerText(), /停用数据图/);
  await frame.locator("#library > summary").click();
  await frame.getByText("当前 PPT 已保存", { exact: true }).waitFor();
  await page.reload();
  const reopened = page.frames().find(item => item.parentFrame());
  await reopened.locator("#library > summary").click();
  await reopened.getByRole("button", { name: /风险页编辑验收.*6 页/ }).click();
  await reopened.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await reopened.locator("#stage [data-metric-part]").count(), 0);
  assert.equal(await reopened.locator('#stage [data-field="0"]').getAttribute("style"), primaryStyle);
  assert.match(await reopened.locator("#stage").innerText(), /准确率91%/);
  assert.equal((await requests(reopened)).length, 0);
});

browserCase("V1 long source points and two auxiliary points fit both preview sizes and export", async (page, initial) => {
  const raw = metricBoundaryDeck();
  const frame = await openMetricFixture(page, initial, raw, "指标长文边界验收");
  for (let number = 2; number <= 4; number++) {
    await frame.getByRole("button", { name: `第 ${number} 页`, exact: true }).click();
    assert.ok(raw.slides[number - 1].points.every(point => point.length === 56));
    await assertMetricBounds(page, frame, `long source ${number}`);
    assert.ok(await frame.locator("#stage [data-metric-part]").count() > 0);
  }
  await metricScreenshot(frame, "05-long-source");
  await metricDownload(page, frame, "long-source");
  assert.equal((await requests(frame)).length, 0);
});

browserCase("C4 real compatibility replay keeps all prose, separate supplement, editable fields and saved layouts", async (page, frame) => {
  await frame.locator("#notes").fill("只回放已保存响应，不调用真实Anna");
  await frame.evaluate(()=>{window.mockOutcome="compat";});await submit(frame);
  await status(frame).filter({hasText:/已生成 6 页/}).waitFor();
  const raw=JSON.parse(platformDiagnostic.originalModelText.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,"$1"));
  const log=()=>frame.locator("#rendering-output").textContent().then(JSON.parse);
  assert.equal((await log()).pages[1].mainMetric.valid,true);
  assert.ok((await log()).pages[1].auxiliaries.every(item=>item.valid));
  assert.equal((await log()).pages[1].mainMetric.applied,false);
  for(const index of [1,2,3,4,5]) {
    await frame.getByRole("button",{name:`第 ${index+1} 页`,exact:true}).click();
    const visible=(await frame.locator("#stage").innerText()).replaceAll("\n","");
    for(const point of raw.slides[index].points)assert.ok(visible.includes(point),point);
    await assertMetricBounds(page,frame,`real replay ${index+1}`);
  }
  await frame.getByRole("button",{name:"第 5 页",exact:true}).click();
  assert.ok((await log()).pages[4].appliedComponents.includes("relation-supplement"));
  if(process.env.BRIEFDECK_COMPAT_EVIDENCE)await frame.locator(".editor").screenshot({path:process.env.BRIEFDECK_COMPAT_EVIDENCE+"/flow-fixed.png"});
  const controls=frame.locator("#layout-controls");await controls.locator("summary").click();
  await controls.getByRole("button",{name:"顺序列表",exact:true}).click();
  await controls.getByRole("button",{name:"撤销上次切换"}).click();
  assert.ok((await log()).pages[4].appliedComponents.includes("relation-sequence"));
  await frame.locator('#stage [data-field="4"]').click();
  const input=frame.getByRole("textbox",{name:"要点 5编辑框",exact:true});assert.equal(await input.inputValue(),raw.slides[4].points[4]);
  await input.fill("四项检查仍并列核对，无先后依赖：数据安全、系统稳定性、业务准确性、人员准备。");await input.press("Enter");
  assert.ok((await log()).pages[4].relationship.applied);
  await frame.locator("#library > summary").click();await frame.getByText("当前 PPT 已保存",{exact:true}).waitFor();
  await page.reload();frame=page.frames().find(item=>item.parentFrame());
  await frame.locator("#library > summary").click();await frame.getByRole("button",{name:/客户服务平台升级项目阶段汇报.*6 页/}).click();
  assert.ok((await log()).pages[4].relationship.applied);
  assert.equal((await requests(frame)).length,0);
});

browserCase("V2 visual relations and diagnostic logs reflect actual choices, preserve edits and saved provenance", async (page, frame) => {
  const raw = visualDeck();
  await frame.locator("#notes").fill("模拟视觉关系回归，不调用真实Anna");
  await frame.evaluate(() => { window.mockOutcome = "visual"; });
  await submit(frame); await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  const readLog = async () => JSON.parse(await frame.locator("#rendering-output").textContent());
  assert.equal((await readLog()).generation.model, "mock-visual");
  assert.equal((await readLog()).pages[1].auxiliaries.filter(item => item.applied).length, 2);
  for (const [index, component] of [[1,"metric-main"],[2,"relation-sequence"],[3,"relation-roles"],[4,null]]) {
    await frame.getByRole("button", { name: `第 ${index+1} 页`, exact:true }).click();
    const report = (await readLog()).pages[index];
    assert.equal(report.appliedComponents.includes(component), Boolean(component));
    await assertMetricBounds(page, frame, `visual page ${index+1}`);
    const visible = (await frame.locator("#stage").innerText()).replaceAll("\n", "");
    for (const point of raw.slides[index].points) assert.ok(visible.includes(point), point);
    if (process.env.BRIEFDECK_VISUAL_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_VISUAL_EVIDENCE}/0${index}-${component ?? "issues"}.png` });
  }
  await frame.getByRole("button", {name:"第 4 页",exact:true}).click();
  const controls = frame.locator("#layout-controls"); await controls.locator("summary").click();
  await controls.getByRole("button",{name:"顺序列表",exact:true}).click();
  assert.ok(!(await readLog()).pages[3].appliedComponents.includes("relation-roles"));
  await controls.getByRole("button",{name:"撤销上次切换"}).click();
  assert.ok((await readLog()).pages[3].appliedComponents.includes("relation-roles"));
  await controls.getByRole("button",{name:"分栏要点",exact:true}).click();
  await controls.getByRole("button",{name:"恢复原布局"}).click();
  assert.ok((await readLog()).pages[3].appliedComponents.includes("relation-roles"));
  const downloading = page.waitForEvent("download"); await frame.locator("#download").click(); const file = await downloading;
  if (process.env.BRIEFDECK_VISUAL_OUTPUT) await file.saveAs(`${process.env.BRIEFDECK_VISUAL_OUTPUT}/visual-relations.pptx`);
  const zip = await JSZip.loadAsync(await readFile(await file.path()));
  for (const index of [1,2,3,4]) {
    const xml = await zip.file(`ppt/slides/slide${index+1}.xml`).async("string");
    const native = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map(item=>item[1]).join("");
    for(const point of raw.slides[index].points) assert.ok(native.includes(point));
    assert.doesNotMatch(xml, /<p:pic>/);
  }
  await frame.getByRole("button",{name:"第 2 页",exact:true}).click();
  await frame.locator('#stage [data-field="1"]').click();
  await frame.getByRole("textbox",{name:"要点 2编辑框",exact:true}).fill("测试用例统计范围已改变，当前结果待重新核对。");
  await frame.getByRole("textbox",{name:"要点 2编辑框",exact:true}).press("Enter");
  assert.equal((await readLog()).pages[1].auxiliaries[0].applied,false);
  assert.match((await readLog()).pages[1].auxiliaries[0].reason,/来源|失效/);
  assert.ok((await readLog()).pages[1].mainMetric.applied);
  await frame.locator("#rendering-diagnostic > summary").click();
  if (process.env.BRIEFDECK_VISUAL_EVIDENCE) await frame.locator("#rendering-diagnostic").screenshot({ path: `${process.env.BRIEFDECK_VISUAL_EVIDENCE}/05-diagnostic.png` });
  const logDownload = page.waitForEvent("download"); await frame.locator("#download-rendering-diagnostic").click(); const logFile = await logDownload;
  const exported = JSON.parse(await readFile(await logFile.path(), "utf8"));
  assert.deepEqual(JSON.parse(exported.originalModelText), raw);
  assert.equal(exported.pages[1].auxiliaries[0].applied,false);
  await frame.locator("#library > summary").click(); await frame.getByText("当前 PPT 已保存",{exact:true}).waitFor();
  await page.reload(); frame = page.frames().find(item=>item.parentFrame());
  await frame.locator("#library > summary").click();
  await frame.getByRole("button",{name:/客服工单分流试点.*6 页/}).click();
  assert.equal((await readLog()).generation.model,"mock-visual");
  assert.equal((await readLog()).pages[1].auxiliaries[0].applied,false);
  assert.equal((await requests(frame)).length,0);
});

browserCase("V2 semantic edits rebuild field bindings and six long roles remain complete", async (page, initial) => {
  const raw = visualBoundaryDeck();
  const frame = await openMetricFixture(page,initial,raw,"长职责编辑回归");
  await frame.getByRole("button",{name:"第 4 页",exact:true}).click();
  await assertMetricBounds(page,frame,"six long role rows");
  await frame.locator('#stage [data-field="0"]').click();
  const input=frame.getByRole("textbox",{name:"要点 1编辑框",exact:true});
  assert.equal(await input.inputValue(),raw.slides[3].points[0]);
  await input.fill("已改为普通问题说明，不再含角色分隔标记。"); await input.press("Enter");
  assert.equal(JSON.parse(await frame.locator("#rendering-output").textContent()).pages[3].relationship.applied,false);
  await frame.locator('#stage [data-field="1"]').click();
  const second=frame.getByRole("textbox",{name:"要点 2编辑框",exact:true});
  assert.equal(await second.inputValue(),raw.slides[3].points[1]);
  await second.press("Escape");
  assert.equal((await requests(frame)).length,0);
});

browserCase("D1.8 focus and P2 keep continuous body numbering across four semantics without Anna", async (page, initial) => {
  let frame = initial;
  for (const layout of ["metrics", "summary", "risk", "decision"]) {
    const raw = knowledgeReviewNumberingDeck(); raw.slides[5].layout = layout;
    frame = await openMetricFixture(page, frame, raw, `编号回归-${layout}`);
    await frame.getByRole("button", { name: "第 6 页", exact: true }).click();
    const controls = frame.locator("#layout-controls"); await controls.locator("summary").click();
    for (const name of ["顺序列表", "分栏要点", "首条重点"]) {
      await controls.getByRole("button", { name, exact: true }).click();
      const labels = await frame.locator("#stage .slide-text").evaluateAll(items => items.map(item => item.textContent).filter(value => /^0[1-4]$/.test(value)));
      assert.deepEqual(labels, ["01", "02", "03", "04"]);
      for (const [field, point] of raw.slides[5].points.entries()) assert.equal((await frame.locator(`#stage [data-field="${field}"]`).innerText()).replaceAll("\n", ""), point);
    }
    await assertMetricBounds(page, frame, `numbered ${layout}`);
    if (layout === "decision" && process.env.BRIEFDECK_NUMBERING_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_NUMBERING_EVIDENCE}/01-focus-fixed.png` });
    await controls.getByRole("button", { name: "撤销上次切换" }).click();
    await controls.getByRole("button", { name: "恢复原布局" }).click();
    assert.deepEqual(await frame.locator("#stage .slide-text").evaluateAll(items => items.map(item => item.textContent).filter(value => /^0[1-4]$/.test(value))), ["01", "02", "03", "04"]);
    assert.equal((await requests(frame)).length, 0);
  }
});

browserCase("D1.7 long generated titles remain complete and editable without character gates", async (page, initial) => {
  const raw = structuredClone(sampleDeck);
  const title = "索引完成率90%，测试通过率90%，准确率86%低于90%目标";
  raw.slides[1] = { layout: "summary", title, points: ["已接入1,200份文档，1,080份完成索引，索引完成率90%（1,080/1,200份）", "测试范围覆盖产品、技术支持、运营三个部门，共45名测试用户"] };
  const frame = await openMetricFixture(page, initial, raw, "标题长度回归");
  assert.equal((await frame.locator('#stage [data-field="title"]').innerText()).replaceAll("\n", ""), title);
  await assertMetricBounds(page, frame, "31-character real title");
  await frame.locator('#stage [data-field="title"]').click();
  const input = frame.getByRole("textbox", { name: "标题编辑框", exact: true });
  assert.equal(await input.getAttribute("maxlength"), null);
  await input.fill(title + "，范围限三个部门"); await input.press("Enter");
  assert.equal((await frame.locator('#stage [data-field="title"]').innerText()).replaceAll("\n", ""), title + "，范围限三个部门");
  await assertMetricBounds(page, frame, "edited longer title");
  assert.equal((await requests(frame)).length, 0);
});

browserCase("D1 replays the complete mentor response and keeps the four stages in order", async (page, frame) => {
  await frame.locator("#notes").fill("回放已保存的导师制真实响应，不调用Anna");
  await frame.evaluate(() => { window.mockOutcome = "mentor-real"; });
  await submit(frame);
  if (process.env.BRIEFDECK_DENSITY_BEFORE === "1") {
    await status(frame).filter({ hasText: /第 4 页的要点数量有误/ }).waitFor();
    await frame.getByText("查看本次生成诊断", { exact: true }).click();
    if (process.env.BRIEFDECK_DENSITY_EVIDENCE) await frame.locator("#brief-form").screenshot({ path: `${process.env.BRIEFDECK_DENSITY_EVIDENCE}/00-before-mentor-failed.png` });
    return;
  }
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  await frame.getByRole("button", { name: "第 4 页", exact: true }).click();
  const raw = JSON.parse(mentorDiagnostic.response.content.text);
  for (const [field, point] of raw.slides[3].points.entries()) {
    assert.equal((await frame.locator(`#stage [data-field="${field}"]`).innerText()).replaceAll("\n", ""), point);
  }
  const locations = await frame.locator('#stage [data-field]:not([data-field="title"])').evaluateAll(items => items.map(item => ({ field: Number(item.dataset.field), y: item.getBoundingClientRect().top, x: item.getBoundingClientRect().left })));
  assert.deepEqual(locations.toSorted((a,b)=>a.y-b.y || a.x-b.x).map(item=>item.field), [0,1,2,3]);
  await assertMetricBounds(page, frame, "mentor four stages");
  if (process.env.BRIEFDECK_DENSITY_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_DENSITY_EVIDENCE}/01-mentor-stages.png` });
  const downloading = page.waitForEvent("download"); await frame.locator("#download").click(); const file = await downloading;
  if (process.env.BRIEFDECK_DENSITY_OUTPUT) await file.saveAs(`${process.env.BRIEFDECK_DENSITY_OUTPUT}/mentor-real-replay.pptx`);
  assert.equal((await requests(frame)).length, 1); // One mocked historical response, no live Anna call.
});

browserCase("D1.2 all one-to-six long points and twelve short points fit without dropping content", async (page, initial) => {
  const raw = densityDeck();
  let frame = await openMetricFixture(page, initial, raw, "密度边界验收");
  for (let index = 1; index < raw.slides.length; index++) {
    await frame.getByRole("button", { name: `第 ${index + 1} 页`, exact: true }).click();
    assert.equal(await frame.locator('#stage [data-field]:not([data-field="title"])').count(), index);
    for (const [field, point] of raw.slides[index].points.entries()) assert.equal((await frame.locator(`#stage [data-field="${field}"]`).innerText()).replaceAll("\n", ""), point);
    await assertMetricBounds(page, frame, `${index} long points`);
    if (process.env.BRIEFDECK_DENSITY_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_DENSITY_EVIDENCE}/02-${index}-long-points.png` });
  }
  const downloading = page.waitForEvent("download"); await frame.locator("#download").click(); const file = await downloading;
  if (process.env.BRIEFDECK_DENSITY_OUTPUT) await file.saveAs(`${process.env.BRIEFDECK_DENSITY_OUTPUT}/density-boundaries.pptx`);
  const zip = await JSZip.loadAsync(await readFile(await file.path()));
  for (let index = 1; index < raw.slides.length; index++) {
    const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`).async("string");
    const text = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map(match => match[1]).join("");
    for (const point of raw.slides[index].points) assert.ok(text.includes(point));
  }
  frame = await openMetricFixture(page, frame, shortDensityDeck(12), "十二条短要点验收");
  assert.equal(await frame.locator('#stage [data-field]:not([data-field="title"])').count(), 12);
  await assertMetricBounds(page, frame, "twelve short points");
  assert.equal((await requests(frame)).length, 0);
});

browserCase("D1.4 adaptive switching, edit, undo and saved restore retain all four stages", async (page, initial) => {
  const raw = JSON.parse(mentorDiagnostic.response.content.text);
  let frame = await openMetricFixture(page, initial, raw, "自适应布局验收");
  await frame.getByRole("button", { name: "第 4 页", exact: true }).click();
  const controls = frame.locator("#layout-controls"); await controls.locator("summary").click();
  assert.deepEqual(await controls.locator(".layout-choice strong").allTextContents(), ["顺序列表", "分栏要点"]);
  const points = [...raw.slides[3].points]; points[2] = "适应阶段：围绕真实任务指导，保留新员工提出的问题，效果尚待验证。";
  await frame.locator('#stage [data-field="2"]').click();
  await frame.getByRole("textbox", { name: "要点 3编辑框", exact: true }).fill(points[2]);
  await controls.getByRole("button", { name: "分栏要点", exact: true }).click();
  for (const [field, point] of points.entries()) assert.equal((await frame.locator(`#stage [data-field="${field}"]`).innerText()).replaceAll("\n", ""), point);
  await controls.getByRole("button", { name: "顺序列表", exact: true }).click();
  await controls.getByRole("button", { name: "撤销上次切换" }).click();
  assert.equal(await controls.getByRole("button", { name: "分栏要点", exact: true }).getAttribute("aria-pressed"), "true");
  await controls.getByRole("button", { name: "恢复原布局" }).click();
  await controls.getByRole("button", { name: "分栏要点", exact: true }).click();
  await frame.locator("#library > summary").click(); await frame.getByText("当前 PPT 已保存", { exact: true }).waitFor();
  const stored = await frame.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mockAnnaStorage")))[0].value);
  assert.deepEqual(stored.deck.slides[3].points, points);
  assert.equal(stored.deck.slides[3].manualLayout, "density-grid");
  await page.reload(); frame = page.frames().find(item => item.parentFrame());
  await frame.locator("#library > summary").click();
  await frame.getByRole("button", { name: /自适应布局验收.*6 页/ }).click();
  await frame.getByRole("button", { name: "第 4 页", exact: true }).click();
  for (const [field, point] of points.entries()) assert.equal((await frame.locator(`#stage [data-field="${field}"]`).innerText()).replaceAll("\n", ""), point);
  await assertMetricBounds(page, frame, "restored four stages");
  if (process.env.BRIEFDECK_DENSITY_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_DENSITY_EVIDENCE}/03-restored-grid.png` });
  assert.equal((await requests(frame)).length, 0);
});

browserCase("D1.3 an unrenderable edit remains in the input and cannot overwrite a saved draft", async (page, initial) => {
  const raw = shortDensityDeck();
  const frame = await openMetricFixture(page, initial, raw, "容量保护验收");
  await frame.locator('#stage [data-field="0"]').click();
  const input = frame.getByRole("textbox", { name: "要点 1编辑框", exact: true });
  const long = "保".repeat(56); await input.fill(long); await input.press("Enter");
  await frame.locator("#density-status").filter({ hasText: "本次编辑未保存" }).waitFor();
  assert.equal(await input.inputValue(), long);
  await frame.getByRole("button", { name: "第 3 页", exact: true }).click();
  assert.equal(await input.inputValue(), long);
  const stored = await frame.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mockAnnaStorage")))[0].value);
  assert.deepEqual(stored.deck.slides[1].points, raw.slides[1].points);
  if (process.env.BRIEFDECK_DENSITY_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_DENSITY_EVIDENCE}/04-edit-not-saved.png` });
  await input.press("Escape");
  assert.equal(await frame.locator('#stage [data-field="0"]').innerText(), raw.slides[1].points[0]);
  assert.equal((await requests(frame)).length, 0);
});

browserCase("P2.1–P2.4 switches sample metrics, commits active edits, preserves pictures and reopens saved layouts without Anna", async (page, frame) => {
  await frame.getByRole("button", { name: "载入示例" }).click();
  assert.ok(await frame.locator("#layout-controls").isHidden());
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const controls = frame.locator("#layout-controls");
  await controls.locator("summary").click();
  assert.match(await controls.locator("summary").innerText(), /第 2 页.*原有布局/);
  assert.deepEqual(await controls.locator(".layout-choice strong").allTextContents(), ["并列展示", "简洁文字"]);
  await controls.getByRole("button", { name: "简洁文字", exact: true }).click();
  assert.equal(await controls.getByRole("button", { name: "简洁文字", exact: true }).getAttribute("aria-pressed"), "true");
  await frame.locator("#stage").getByRole("button", { name: "编辑要点 1", exact: true }).click();
  await frame.getByRole("textbox", { name: "要点 1编辑框", exact: true }).fill("仅工作日处理492单，范围限两个业务组。");
  // Click without Enter or a separate blur: the layout transaction must commit the edit.
  await controls.getByRole("button", { name: "并列展示", exact: true }).click();
  assert.match(await frame.locator("#stage").innerText(), /仅工作日处理492单，范围限两个业务组/);
  await controls.getByRole("button", { name: "撤销上次切换" }).click();
  assert.equal(await controls.getByRole("button", { name: "简洁文字", exact: true }).getAttribute("aria-pressed"), "true");
  assert.match(await frame.locator("#stage").innerText(), /492单/);
  await controls.getByRole("button", { name: "恢复原布局" }).click();
  assert.match(await controls.locator("summary").innerText(), /原有布局/);
  const image = await picture(frame, "png", 58);
  await frame.locator("#picture-file").setInputFiles(image);
  const figure = frame.locator("#stage").getByRole("group", { name: image.name });
  await figure.waitFor();
  await figure.focus();
  await figure.press("ArrowLeft");
  const pictureStyle = await figure.getAttribute("style");
  await controls.getByRole("button", { name: "简洁文字", exact: true }).click();
  assert.equal(await figure.getAttribute("style"), pictureStyle);
  await figure.focus();
  await figure.press("ArrowLeft");
  const movedStyle = await figure.getAttribute("style");
  assert.notEqual(movedStyle, pictureStyle);
  await controls.getByRole("button", { name: "并列展示", exact: true }).click();
  assert.equal(await figure.getAttribute("style"), movedStyle);
  await controls.getByRole("button", { name: "简洁文字", exact: true }).click();
  await frame.locator("#library > summary").click();
  await frame.getByRole("button", { name: "保存当前 PPT" }).click();
  await frame.getByText("当前 PPT 已保存", { exact: true }).waitFor();
  const stored = await frame.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mockAnnaStorage")))[0].value);
  assert.equal(stored.deck.slides[1].manualLayout, "plain");
  assert.deepEqual(stored.deck.slides.filter((_, i) => i !== 1), sampleDeck.slides.filter((_, i) => i !== 1));
  assert.equal((await requests(frame)).length, 0);
  await page.reload();
  const reopened = page.frames().find(item => item.parentFrame());
  await reopened.locator("#library > summary").click();
  await reopened.getByRole("button", { name: /客服工单分流试点.*6 页/ }).click();
  await reopened.getByRole("button", { name: "第 2 页", exact: true }).click();
  await reopened.locator("#layout-controls > summary").click();
  assert.equal(await reopened.getByRole("button", { name: "简洁文字", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await reopened.getByRole("group", { name: image.name }).getAttribute("style"), movedStyle);
  assert.match(await reopened.locator("#stage").innerText(), /仅工作日处理492单，范围限两个业务组/);
  const downloading = page.waitForEvent("download");
  await reopened.locator("#download").click();
  const downloaded = await downloading;
  const zip = await JSZip.loadAsync(await readFile(await downloaded.path()));
  const xml = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.match(xml, /仅工作日处理492单，范围限两个业务组/);
  assert.match(xml, /<p:pic>/);
  assert.match(xml, /<p:sp>/);
  if (process.env.BRIEFDECK_P2_EVIDENCE) await reopened.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_P2_EVIDENCE}/01-restored-metrics.png` });
  if (process.env.BRIEFDECK_P2_OUTPUT) await downloaded.saveAs(`${process.env.BRIEFDECK_P2_OUTPUT}/p2-saved-with-picture.pptx`);
  assert.equal((await requests(reopened)).length, 0);
  // The standalone preview uses IndexedDB rather than Anna's storage adapter.
  await page.goto(origin + "/bundle/index.html");
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.getByRole("button", { name: "第 2 页", exact: true }).click();
  await page.locator("#layout-controls > summary").click();
  await page.getByRole("button", { name: "简洁文字", exact: true }).click();
  await page.locator("#library > summary").click();
  await page.getByRole("button", { name: "保存当前 PPT" }).click();
  await page.getByText("当前 PPT 已保存", { exact: true }).waitFor();
  await page.reload();
  await page.locator("#library > summary").click();
  await page.getByRole("button", { name: /客服工单分流试点.*6 页/ }).click();
  await page.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.match(await page.locator("#layout-current").innerText(), /简洁文字/);
});

browserCase("P2 local seeded history offers three compatible choices, keeps per-page undo and ignores invalid overrides", async (page, frame) => {
  const slides = structuredClone(sampleDeck.slides);
  slides[0].title = "布局切换回归";
  const real = JSON.parse(realP1Response.content.text);
  slides[1] = real.slides[1];
  // Seed normalized history using a synthetic summary; no live generation is required.
  slides[1].design = slides[1].design.map(([point, kind, x, y, w, h]) => ({ point, kind, x, y, w, h }));
  slides[2] = { layout: "summary", title: "当前证据支持阶段复盘，扩大范围仍需验证", points: [
    "首次响应中位数改善，结论仅适用于当前试点范围和统计周期。",
    "复核覆盖保持100%，未验证减少人工审核工作量的效果。",
    "下一阶段先补齐样本与稳定性证据，再由负责人决定是否扩大试点。"
  ] };
  const record = { id: "p2-seeded", title: "布局切换回归", pageCount: 6, updatedAt: Date.now(), style: { theme: "minimal", accent: "" }, deck: { slides } };
  await frame.evaluate(record => localStorage.setItem("mockAnnaStorage", JSON.stringify({
    "briefdeck/drafts/p2-seeded": { value: record, metadata: { schema: 1, title: record.title, pageCount: 6, updatedAt: record.updatedAt }, etag: "initial" }
  })), record);
  await page.reload();
  const active = page.frames().find(item => item.parentFrame());
  await active.locator("#library > summary").click();
  await active.getByRole("button", { name: /布局切换回归.*6 页/ }).click();
  const controls = active.locator("#layout-controls");
  const canvas = active.locator("#stage");
  const snapshot = () => active.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mockAnnaStorage")))[0].value.deck.slides);
  for (const [number, names] of [[2, ["重点指标", "并列展示", "简洁文字"]], [3, ["突出首条", "并列展示", "简洁文字"]]]) {
    await active.getByRole("button", { name: `第 ${number} 页`, exact: true }).click();
    await controls.locator("summary").click();
    assert.deepEqual(await controls.locator(".layout-choice strong").allTextContents(), names);
    for (const name of names) {
      await controls.getByRole("button", { name, exact: true }).click();
      assert.equal(await controls.getByRole("button", { name, exact: true }).getAttribute("aria-pressed"), "true");
      for (const width of [1200, 480]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await canvas.locator(".slide-text").evaluateAll(items => items.filter(item => item.textContent).every(item => {
          const range = document.createRange(); range.selectNodeContents(item);
          const text = range.getBoundingClientRect(), box = item.getBoundingClientRect();
          return text.top >= box.top - 1 && text.bottom <= box.bottom + 1 && text.right <= box.right + 1;
        })), `${number} ${name} fits at ${width}`);
      }
      await page.setViewportSize({ width: 1200, height: 900 });
      if (process.env.BRIEFDECK_P2_EVIDENCE) await active.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_P2_EVIDENCE}/${number}-${name}.png` });
    }
    await controls.getByRole("button", { name: "撤销上次切换" }).click();
    assert.equal(await controls.getByRole("button", { name: "并列展示", exact: true }).getAttribute("aria-pressed"), "true");
    await controls.getByRole("button", { name: "恢复原布局" }).click();
    await controls.getByRole("button", { name: names[0], exact: true }).click();
  }
  await active.getByRole("button", { name: "第 2 页", exact: true }).click();
  await controls.locator("summary").click();
  assert.equal(await controls.getByRole("button", { name: "重点指标", exact: true }).getAttribute("aria-pressed"), "true");
  await controls.getByRole("button", { name: "撤销上次切换" }).click();
  assert.match(await controls.locator("summary").innerText(), /原有布局/);
  await controls.getByRole("button", { name: "重点指标", exact: true }).click();
  await canvas.getByRole("button", { name: "编辑要点 2", exact: true }).click();
  const rawEditor = canvas.getByRole("textbox", { name: "要点 2编辑框", exact: true });
  assert.equal(await rawEditor.inputValue(), slides[1].points[1]);
  await rawEditor.press("Escape");
  await active.locator("#library > summary").click();
  await active.getByText("当前 PPT 已保存", { exact: true }).waitFor();
  const final = await snapshot();
  assert.deepEqual(final.filter((_, i) => ![1, 2].includes(i)), slides.filter((_, i) => ![1, 2].includes(i)));
  assert.deepEqual(final.map(slide => slide.points), slides.map(slide => slide.points));
  const downloading = page.waitForEvent("download");
  await active.locator("#download").click();
  const downloaded = await downloading;
  if (process.env.BRIEFDECK_P2_OUTPUT) await downloaded.saveAs(`${process.env.BRIEFDECK_P2_OUTPUT}/p2-focus-and-summary.pptx`);
  assert.equal((await requests(active)).length, 0);
  // Corrupt only the optional user override in persisted history; keep the original design.
  await active.evaluate(() => {
    const records = JSON.parse(localStorage.getItem("mockAnnaStorage"));
    Object.values(records)[0].value.deck.slides[1].manualLayout = "unknown-layout";
    localStorage.setItem("mockAnnaStorage", JSON.stringify(records));
  });
  await page.reload();
  const restored = page.frames().find(item => item.parentFrame());
  await restored.locator("#library > summary").click();
  await restored.getByRole("button", { name: /布局切换回归.*6 页/ }).click();
  await restored.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await restored.locator("#stage").getByText("18 → 11 分钟", { exact: true }).count(), 1);
  await restored.getByRole("button", { name: "第 4 页", exact: true }).click();
  assert.ok(await restored.locator("#layout-controls").isHidden());
  assert.equal((await requests(restored)).length, 0);
});

browserCase("P2 failed local switch retains the previous layout and content", async (page) => {
  await page.route(origin + "/bundle/layout.js", async route => {
    const body = (await readFile(new URL("../release/bundle/layout.js", import.meta.url), "utf8"))
      .replace('const candidate = { ...slide, manualLayout: choice };', 'if (globalThis.mockLocalLayoutFailure) throw new Error("本地布局校验失败，已保留原布局。"); const candidate = { ...slide, manualLayout: choice };');
    await route.fulfill({ contentType: "text/javascript", body });
  });
  await page.reload();
  const frame = page.frames().find(item => item.parentFrame());
  await frame.getByRole("button", { name: "载入示例" }).click();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const controls = frame.locator("#layout-controls");
  await controls.locator("summary").click();
  await controls.getByRole("button", { name: "简洁文字", exact: true }).click();
  const before = await frame.locator("#stage .slide-text").evaluateAll(items => items.map(item => [item.textContent, item.getAttribute("style")]));
  await frame.evaluate(() => { window.mockLocalLayoutFailure = true; });
  await controls.getByRole("button", { name: "并列展示", exact: true }).click();
  assert.match(await frame.locator("#layout-status").innerText(), /已保留原布局/);
  assert.equal(await controls.getByRole("button", { name: "简洁文字", exact: true }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(await frame.locator("#stage .slide-text").evaluateAll(items => items.map(item => [item.textContent, item.getAttribute("style")])), before);
  if (process.env.BRIEFDECK_P2_EVIDENCE) await frame.locator(".editor").screenshot({ path: `${process.env.BRIEFDECK_P2_EVIDENCE}/04-switch-rejected.png` });
  await frame.evaluate(() => { window.mockLocalLayoutFailure = false; });
  await controls.getByRole("button", { name: "并列展示", exact: true }).click();
  assert.equal(await controls.getByRole("button", { name: "并列展示", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal((await requests(frame)).length, 0);
});

browserCase("P2 all compatible 56-character layout variants fit narrow preview and export natively", async (page, frame) => {
  const deck = boundaryLayoutDeck();
  const count = deck.slides.length;
  assert.ok(count >= 4);
  for (const slide of deck.slides.slice(1)) assert.ok(slide.points.every(point => point.length === 56));
  await frame.evaluate(deck => localStorage.setItem("mockAnnaStorage", JSON.stringify({
    "briefdeck/drafts/p2-boundary": { etag: "boundary", metadata: { schema: 1, title: "长文边界", pageCount: deck.slides.length, updatedAt: Date.now() },
      value: { id: "p2-boundary", title: "长文边界", pageCount: deck.slides.length, style: { theme: "minimal" }, deck, updatedAt: Date.now() } }
  })), deck);
  await page.reload();
  const active = page.frames().find(item => item.parentFrame());
  await active.locator("#library > summary").click();
  await active.getByRole("button", { name: new RegExp(`长文边界.*${count} 页`) }).click();
  for (let number = 2; number <= count; number++) {
    await active.getByRole("button", { name: `第 ${number} 页`, exact: true }).click();
    for (const width of [1200, 480]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await active.locator("#stage .slide-text").evaluateAll(items => items.filter(item => item.textContent).every(item => {
        const range = document.createRange(); range.selectNodeContents(item);
        const text = range.getBoundingClientRect(), box = item.getBoundingClientRect();
        return text.left >= box.left - 1 && text.top >= box.top - 1 && text.bottom <= box.bottom + 1 && text.right <= box.right + 1;
      })), `56-character layout page ${number} fits ${width}`);
    }
  }
  const downloading = page.waitForEvent("download");
  await active.locator("#download").click();
  const downloaded = await downloading;
  if (process.env.BRIEFDECK_P2_OUTPUT) await downloaded.saveAs(`${process.env.BRIEFDECK_P2_OUTPUT}/p2-boundary-layouts.pptx`);
  assert.equal((await requests(active)).length, 0);
});

browserCase("P1.2 migration excerpt with simulated lead keeps evidence, editable export and bounds", async (page, frame) => {
  await frame.locator("#notes").fill("模拟主证据参数，内容取自迁移真实页面");
  await frame.evaluate(() => { window.mockOutcome = "migration-excerpt"; });
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const canvas = frame.locator("#stage");
  assert.equal(await canvas.getByText("8 → 2 分钟", { exact: true }).count(), 1);
  assert.match(await canvas.innerText(), /缩短约 75%[\s\S]*12,000份[\s\S]*9,600份[\s\S]*80%[\s\S]*99.2%[\s\S]*99.5%[\s\S]*36名员工/);
  for (const width of [1200, 480]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await canvas.locator(".slide-text").evaluateAll(items => items.filter(item => item.textContent).every(item => {
      const range = document.createRange(); range.selectNodeContents(item);
      const content = range.getBoundingClientRect(), box = item.getBoundingClientRect();
      return content.top >= box.top - 1 && content.bottom <= box.bottom + 1 && content.right <= box.right + 1;
    })));
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  if (process.env.BRIEFDECK_P12_EVIDENCE) await canvas.screenshot({ path: `${process.env.BRIEFDECK_P12_EVIDENCE}/02-migration-browser.png` });
  const downloading = page.waitForEvent("download");
  await frame.locator("#download").click();
  const downloaded = await downloading;
  if (process.env.BRIEFDECK_P12_OUTPUT) await downloaded.saveAs(process.env.BRIEFDECK_P12_OUTPUT);
  await editSlideText(frame, "要点 1", migrationExcerpt.points[0].replace("至2分钟", "至4分钟"));
  assert.equal(await canvas.getByText("8 → 4 分钟", { exact: true }).count(), 1);
  assert.match(await canvas.innerText(), /缩短约 50%/);
  assert.equal((await requests(frame)).length, 1);
});

browserCase("P1.1 replays real metrics and recommendation, and downloads failed-cover diagnostics", async (page, frame) => {
  await frame.locator("#notes").fill("回放已取得的真实响应");
  await frame.evaluate(() => { window.mockOutcome = "real-p1"; });
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  const canvas = frame.locator("#stage");
  const takeScreenshot = async name => {
    if (process.env.BRIEFDECK_P11_EVIDENCE) await page.screenshot({
      path: `${process.env.BRIEFDECK_P11_EVIDENCE}/${name}.png`, fullPage: true
    });
  };
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await canvas.getByText("18 → 11 分钟", { exact: true }).count(), 1);
  assert.match(await canvas.innerText(), /缩短约 39%[\s\S]*480单[\s\S]*92%[\s\S]*95%[\s\S]*100%/);
  await takeScreenshot("01-real-metrics-repaired");
  await frame.getByRole("button", { name: "第 6 页", exact: true }).click();
  assert.equal(await canvas.getByText("当前建议", { exact: true }).count(), 1);
  const recommendation = canvas.getByRole("button", { name: "编辑要点 2", exact: true });
  const condition = canvas.getByRole("button", { name: "编辑要点 1", exact: true });
  assert.ok((await recommendation.boundingBox()).width > (await condition.boundingBox()).width);
  await takeScreenshot("02-real-decision-repaired");
  for (const number of [2, 3, 4, 5, 6]) {
    await frame.getByRole("button", { name: `第 ${number} 页`, exact: true }).click();
    for (const width of [1200, 480]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await canvas.locator(".slide-text").evaluateAll(elements => elements.filter(item => item.textContent).every(item => {
        const range = document.createRange();
        range.selectNodeContents(item);
        const content = range.getBoundingClientRect();
        const box = item.getBoundingClientRect();
        return content.top >= box.top - 1 && content.bottom <= box.bottom + 1 && content.right <= box.right + 1;
      })), `real page ${number} fits at ${width}px`);
    }
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  const downloading = page.waitForEvent("download");
  await frame.locator("#download").click();
  const pptx = await downloading;
  if (process.env.BRIEFDECK_P11_OUTPUT) await pptx.saveAs(process.env.BRIEFDECK_P11_OUTPUT);
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  await editSlideText(frame, "要点 1", "首次响应时间中位数由试点前18分钟降至12分钟，处理工单480单。");
  assert.equal(await canvas.getByText("18 → 12 分钟", { exact: true }).count(), 1);
  await frame.evaluate(() => { window.mockOutcome = "cover-shape"; });
  await submit(frame);
  await status(frame).filter({ hasText: /第 1 页的要点数量有误/ }).waitFor();
  await frame.getByText("查看本次生成诊断", { exact: true }).click();
  await frame.locator("#generation-diagnostic").scrollIntoViewIfNeeded();
  await takeScreenshot("03-cover-diagnostic");
  const diagnosticDownload = page.waitForEvent("download");
  await frame.getByRole("button", { name: "下载诊断 JSON" }).click();
  const diagnostic = JSON.parse(await readFile(await (await diagnosticDownload).path(), "utf8"));
  assert.match(diagnostic.error, /第 1 页的要点数量有误/);
  assert.equal(diagnostic.response.model, "xiaomi/mimo-v2.5");
  assert.deepEqual(JSON.parse(diagnostic.response.content.text).slides[0].points, ["汇报周期", "覆盖范围"]);
  assert.equal(await canvas.getByText("18 → 12 分钟", { exact: true }).count(), 1);
  assert.equal((await requests(frame)).length, 2);
});

browserCase("P1 renders the chosen lead as the most prominent evidence and keeps it editable", async (page, frame) => {
  await frame.locator("#notes").fill(prioritizedPilot.notes);
  await frame.locator("#audience").fill("项目负责人");
  await frame.locator("#page-count").fill("4");
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 4 页/ }).waitFor();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const canvas = frame.locator("#stage");
  const metric = canvas.getByText("18 → 11 分钟", { exact: true });
  const support = canvas.getByText("480 单", { exact: true });
  assert.ok((await metric.boundingBox()).width > (await support.boundingBox()).width);
  assert.match(await canvas.innerText(), /缩短约 39%/);
  assert.doesNotMatch(await canvas.innerText(), /中位数由 18/);
  assert.match(await canvas.innerText(), /覆盖 2 个业务组/);
  const calls = await requests(frame);
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content.text, /给负责人先讲结果/);
  assert.equal(JSON.parse(calls[0].messages[0].content.text.split("\n").at(-1)).audience, "项目负责人");
  if (process.env.BRIEFDECK_P1_EVIDENCE) {
    await page.screenshot({ path: `${process.env.BRIEFDECK_P1_EVIDENCE}/01-lead-metric.png`, fullPage: true });
  }
  await canvas.getByRole("button", { name: "编辑要点 2", exact: true }).press("Enter");
  const input = canvas.getByRole("textbox", { name: "要点 2编辑框" });
  assert.equal(await input.inputValue(), prioritizedPilot.slides[1].points[1]);
  await input.fill("仅工作日的首次响应中位数由 18 分钟降至 12 分钟。");
  await input.press("Enter");
  assert.match(await canvas.innerText(), /18 → 12 分钟[\s\S]*缩短约 33%[\s\S]*仅工作日/);
  for (const width of [1200, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const within = await canvas.locator(".slide-text").evaluateAll(items => items.filter(item => item.textContent).every(item => {
      const range = document.createRange();
      range.selectNodeContents(item);
      const area = range.getBoundingClientRect();
      const box = item.getBoundingClientRect();
      return area.left >= box.left - 1 && area.right <= box.right + 1 && area.top >= box.top - 1 && area.bottom <= box.bottom + 1;
    }));
    assert.ok(within, `P1 text fits at ${width}px`);
  }
  const download = page.waitForEvent("download");
  await frame.locator("#download").click();
  const file = await download;
  if (process.env.BRIEFDECK_P1_OUTPUT) await file.saveAs(process.env.BRIEFDECK_P1_OUTPUT);
  const zip = await JSZip.loadAsync(await readFile(await file.path()));
  assert.match(await zip.file("ppt/slides/slide2.xml").async("string"), /<a:t>18 → 12 分钟<\/a:t>/);
  assert.equal((await requests(frame)).length, 1);
});

browserCase("M5.1–M5.2 render, edit and export an evidence comparison and a migration timeline", async (page, frame) => {
  const canvas = frame.locator("#stage");
  await frame.locator("#page-count").fill("4");
  await frame.locator("#notes").fill(supportPilot.notes);
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 4 页/ }).waitFor();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const point = i => canvas.getByRole("button", { name: `编辑要点 ${i}`, exact: true });
  const pilot = await Promise.all([point(1).boundingBox(), point(2).boundingBox(), point(3).boundingBox()]);
  assert.ok(pilot[0].x < pilot[1].x && pilot[2].y > pilot[1].y);
  assert.match(await canvas.innerText(), /前\s+18 分钟[\s\S]*后\s+11 分钟/);
  const screenshot = async name => {
    if (process.env.BRIEFDECK_M5_EVIDENCE) {
      await page.screenshot({ path: `${process.env.BRIEFDECK_M5_EVIDENCE}/${name}.png`, fullPage: true });
    }
  };
  await screenshot("01-pilot-comparison");
  await editSlideText(frame, "要点 1", "首次响应中位数由 18 分钟降至 12 分钟。");
  await editSlideText(frame, "标题", "首次响应缩短 6 分钟");
  assert.match(await canvas.innerText(), /后\s+12 分钟/);
  const evidence = await picture(frame, "png", 58);
  await frame.locator("#picture-file").setInputFiles(evidence);
  await canvas.getByRole("img", { name: evidence.name }).waitFor();
  assert.match(await canvas.innerText(), /后\s+12 分钟/);
  const assertDownload = async (expected, fileName, pictureCount = 0) => {
    const download = page.waitForEvent("download");
    await frame.locator("#download").click();
    const file = await download;
    if (process.env.BRIEFDECK_M5_OUTPUT) await file.saveAs(`${process.env.BRIEFDECK_M5_OUTPUT}/${fileName}.pptx`);
    const zip = await JSZip.loadAsync(await readFile(await file.path()));
    assert.equal(zip.file(/^ppt\/slides\/slide\d+\.xml$/).length, 4);
    const slideXml = await zip.file("ppt/slides/slide2.xml").async("string");
    const nativeText = [...slideXml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map(match => match[1]).join("");
    assert.ok(nativeText.includes(expected), expected); // Display line breaks may split one point across native paragraphs.
    assert.equal([...slideXml.matchAll(/<p:pic>/g)].length, pictureCount);
  };
  await assertDownload("后  12 分钟", "m5-pilot", 1);
  assert.equal((await requests(frame)).length, 1);

  await frame.locator("#notes").fill(archiveMigration.notes);
  await submit(frame, true);
  await status(frame).filter({ hasText: /已生成 4 页/ }).waitFor();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const timeline = await Promise.all([point(1).boundingBox(), point(2).boundingBox(), point(3).boundingBox()]);
  assert.ok(timeline[0].x < timeline[1].x && timeline[1].x < timeline[2].x);
  assert.equal(timeline[0].y, timeline[2].y);
  assert.match(await canvas.innerText(), /11 月 23 日[\s\S]*11 月 26 日[\s\S]*11 月 30 日/);
  await screenshot("02-migration-timeline");
  await page.setViewportSize({ width: 480, height: 900 });
  assert.ok(await canvas.locator(".slide-text[role=button]").evaluateAll(elements => elements.every(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return text.right <= box.right + 1 && text.top >= box.top - 1 && text.bottom <= box.bottom + 1;
  })));
  await assertDownload("11 月 30 日，核对结果后切换。", "m5-migration");
  const calls = await requests(frame);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.messages[0].content.text.includes("12×12 整数网格")));
});

browserCase("M1.6 and M2.5 update local styling and send style and optional instructions on Generate", async (page, frame) => {
  const theme = frame.locator("#ppt-theme");
  const color = frame.locator("#ppt-color");
  const slide = frame.locator("#stage .slide");
  const requestText = frame.locator("#ppt-instructions");
  assert.equal(await theme.inputValue(), "minimal");
  assert.equal(await color.inputValue(), "#3e795b");
  assert.equal(await requestText.inputValue(), "");
  await frame.getByRole("button", { name: "载入示例" }).click();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const originalText = await slide.innerText();
  assert.equal(await slide.evaluate(el => el.style.backgroundColor), "rgb(255, 255, 255)");
  await theme.selectOption("technology");
  assert.equal(await color.inputValue(), "#48d7ef");
  assert.equal(await slide.evaluate(el => el.style.backgroundColor), "rgb(11, 21, 39)");
  assert.equal(await slide.innerText(), originalText);
  assert.equal(await slide.getAttribute("data-layout"), "metrics");
  if (process.env.BRIEFDECK_LAYOUT_EVIDENCE) {
    await page.screenshot({ path: `${process.env.BRIEFDECK_LAYOUT_EVIDENCE}/example-technology.png`, fullPage: true });
  }
  await color.fill("#a837e0");
  const file = page.waitForEvent("download");
  await frame.locator("#download").click();
  const path = await (await file).path();
  const zip = await JSZip.loadAsync(await readFile(path));
  const exported = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.match(exported, /val="A837E0"/);
  assert.match(exported, /<p:bg>.*?val="34174C"/);
  assert.match(exported, /<a:t>480 单<\/a:t>/);
  assert.equal((await requests(frame)).length, 0);
  await frame.getByRole("button", { name: "恢复默认" }).click();
  assert.equal(await color.inputValue(), "#48d7ef");
  await color.fill("#a837e0");
  await requestText.fill("重点讲风险和下一步");
  assert.equal((await requests(frame)).length, 0);
  await submit(frame, true);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  const calls = await requests(frame);
  assert.equal(calls.length, 1);
  const [request] = calls;
  assert.match(request.messages[0].content.text, /"instructions":"重点讲风险和下一步"/);
  assert.equal(request.maxTokens, 6016);
  assert.deepEqual(JSON.parse(request.messages[0].content.text.split("\n").at(-1)).style, { theme: "technology", accent: "#A837E0" });
  assert.equal(await theme.inputValue(), "technology");
  await theme.selectOption("minimal");
  await frame.getByRole("button", { name: "恢复默认" }).click();
  await requestText.fill("");
  await submit(frame, true);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  const second = (await requests(frame))[1].messages[0].content.text;
  assert.match(second, /简约风：每页聚焦一个判断/);
  const input = JSON.parse(second.split("\n").at(-1));
  assert.deepEqual(input.style, { theme: "minimal", accent: "#3E795B" });
  assert.equal(input.instructions, undefined);
});

browserCase("M3.3 and M4.3 edit directly on the canvas and export the saved content", async (page, frame) => {
  const canvas = frame.locator("#stage");
  await frame.getByRole("button", { name: "载入示例" }).click();
  await canvas.getByRole("button", { name: "编辑副标题" }).press("Enter");
  const subtitle = canvas.getByRole("textbox", { name: "副标题编辑框" });
  await subtitle.fill("项目负责人周会");
  await subtitle.press("Enter");
  assert.match(await canvas.innerText(), /项目负责人周会/);

  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const editTitle = canvas.getByRole("button", { name: "编辑标题" });
  await editTitle.click();
  const title = canvas.getByRole("textbox", { name: "标题编辑框" });
  await title.fill("响应时间缩短，复核稳定");
  if (process.env.BRIEFDECK_INLINE_EVIDENCE) {
    await page.screenshot({ path: `${process.env.BRIEFDECK_INLINE_EVIDENCE}/01-title-inline-edit.png`, fullPage: true });
  }
  await title.press("Enter");
  assert.equal(await editTitle.evaluate(el => document.activeElement === el), true);
  const firstPoint = canvas.getByRole("button", { name: "编辑要点 1", exact: true });
  await firstPoint.press("Space");
  const pointEditor = canvas.getByRole("textbox", { name: "要点 1编辑框" });
  await pointEditor.fill("未提交的数字 501 单");
  await pointEditor.press("Escape");
  assert.doesNotMatch(await canvas.innerText(), /501 单/);
  assert.match(await canvas.innerText(), /480 单/);
  await firstPoint.click();
  await pointEditor.fill("本周处理 492 单");
  const nextPoint = canvas.getByRole("button", { name: "编辑要点 2", exact: true });
  await nextPoint.click();
  const secondEditor = canvas.getByRole("textbox", { name: "要点 2编辑框" });
  await secondEditor.press("Escape");
  assert.equal(await canvas.getByText("492 单", { exact: true }).count(), 1);
  assert.doesNotMatch(await canvas.innerText(), /480 单/);

  await frame.getByRole("button", { name: "第 4 页", exact: true }).click();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.match(await canvas.innerText(), /响应时间缩短，复核稳定/);
  assert.match(await canvas.innerText(), /492 单/);
  assert.equal(await canvas.locator(".slide").getAttribute("data-layout"), "metrics");
  const download = page.waitForEvent("download");
  await frame.locator("#download").click();
  const file = await download;
  if (process.env.BRIEFDECK_INLINE_PPTX) await file.saveAs(process.env.BRIEFDECK_INLINE_PPTX);
  const pptx = await JSZip.loadAsync(await readFile(await file.path()));
  const cover = await pptx.file("ppt/slides/slide1.xml").async("string");
  const metrics = await pptx.file("ppt/slides/slide2.xml").async("string");
  assert.match(cover, /<a:t>项目负责人周会<\/a:t>/);
  assert.match(metrics, /<a:t>响应时间缩短，复核稳定<\/a:t>/);
  assert.match(metrics, /<a:t>492 单<\/a:t>/);
  assert.equal((await requests(frame)).length, 0);
});

browserCase("M3.4 and M4.4 edit independent pictures and export their geometry without calling Anna", async (page, frame) => {
  const canvas = frame.locator("#stage");
  const selectFile = frame.locator("#picture-file");
  const takeScreenshot = async name => {
    if (process.env.BRIEFDECK_PICTURE_EVIDENCE) {
      await page.screenshot({ path: `${process.env.BRIEFDECK_PICTURE_EVIDENCE}/${name}.png`, fullPage: true });
    }
  };
  await frame.getByRole("button", { name: "载入示例" }).click();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  const textState = () => canvas.locator(".slide-text").evaluateAll(elements =>
    elements.map(element => [element.textContent, element.getAttribute("style")]));
  const original = await textState();
  const landscape = await picture(frame, "png", 360);
  const portrait = await picture(frame, "jpeg", 58);
  const extra = { ...(await picture(frame, "png", 130)), name: "另外一张.png" };
  const choose = page.waitForEvent("filechooser", { timeout: 5000 });
  await frame.getByRole("button", { name: "插入图片" }).click();
  await (await choose).setFiles([landscape, portrait]);
  const figure = canvas.getByRole("group", { name: landscape.name, exact: true });
  const vertical = canvas.getByRole("group", { name: portrait.name, exact: true });
  await vertical.waitFor();
  assert.equal(await canvas.getByRole("img").count(), 2);
  assert.equal(await frame.locator("#picture-status").textContent(), "");
  assert.equal(await figure.getByRole("button", { name: /移除图片/ }).count(), 0);
  assert.equal(await vertical.getByRole("button", { name: /移除图片/ }).count(), 1);
  assert.deepEqual(await textState(), original);
  const before = await figure.boundingBox();
  const drag = async (x, y, dx, dy) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
  };
  await drag(before.x + 15, before.y + 10, -170, -300);
  const moved = await figure.boundingBox();
  assert.ok(moved.y < before.y - 200);
  assert.ok(moved.x < before.x - 130);
  await drag(moved.x + moved.width - 5, moved.y + moved.height - 5, 28, 12);
  const resized = await figure.boundingBox();
  assert.ok(resized.width > moved.width + 20);
  assert.ok(Math.abs(resized.width / resized.height - 3.6) < 0.03);
  const verticalBounds = await vertical.boundingBox();
  assert.ok(Math.abs(verticalBounds.width / verticalBounds.height - 0.58) < 0.02);
  assert.deepEqual(await textState(), original);
  await frame.getByRole("button", { name: "第 4 页", exact: true }).click();
  assert.equal(await canvas.getByRole("img").count(), 0);
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  await frame.locator("#ppt-theme").selectOption("technology");
  assert.deepEqual(await figure.boundingBox(), resized);
  await selectFile.setInputFiles([extra, file("损坏.png"), file("超限.png", Buffer.alloc(5 * 1024 * 1024 + 1))]);
  const feedback = frame.locator("#picture-status").filter({ hasText: /图片内容与格式不符/ });
  await feedback.waitFor();
  assert.match(await feedback.innerText(), /不能超过 5 MB/);
  assert.doesNotMatch(await feedback.innerText(), /添加.*张图片/);
  assert.equal(await canvas.getByRole("img").count(), 3);
  await editSlideText(frame, "要点 1", "本周已核对 480 单");
  const originalVertical = await vertical.boundingBox();
  await vertical.focus();
  await vertical.press("ArrowUp");
  const movedVertical = await vertical.boundingBox();
  assert.ok(movedVertical.y < originalVertical.y);
  await vertical.press("Shift+ArrowLeft");
  assert.ok((await vertical.boundingBox()).width < movedVertical.width);
  await frame.getByRole("button", { name: "第 4 页", exact: true }).click();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  assert.equal(await canvas.getByRole("button", { name: /移除图片/ }).count(), 0);
  await frame.getByRole("combobox", { name: "选择本页图片" }).selectOption("0");
  assert.equal(await figure.getAttribute("data-selected"), "true");
  const remove = figure.getByRole("button", { name: `移除图片 ${landscape.name}` });
  assert.equal(await frame.locator("#picture-controls").getByRole("button", { name: /移除图片/ }).count(), 0);
  const [buttonBounds, imageBounds] = await Promise.all([remove.boundingBox(), figure.boundingBox()]);
  assert.ok(Math.abs(buttonBounds.y - imageBounds.y) < 1);
  assert.ok(Math.abs(buttonBounds.x + buttonBounds.width - imageBounds.x - imageBounds.width) < 1);
  await takeScreenshot("07-inline-picture-delete");
  const stageBounds = await canvas.locator(".slide").boundingBox();
  const expected = page.waitForEvent("download");
  await frame.locator("#download").click();
  const downloaded = await expected;
  if (process.env.BRIEFDECK_PICTURE_PPTX) await downloaded.saveAs(process.env.BRIEFDECK_PICTURE_PPTX);
  const zip = await JSZip.loadAsync(await readFile(await downloaded.path()));
  const slideXml = await zip.file("ppt/slides/slide2.xml").async("string");
  const images = [...slideXml.matchAll(/<p:pic>.*?<\/p:pic>/gs)];
  assert.equal(images.length, 3);
  const geometry = images[0][0].match(/<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  assert.ok(geometry);
  const [x, y, w, h] = geometry.slice(1).map(value => Number(value) / 914400);
  for (const [actual, expected] of [[x, (resized.x - stageBounds.x) * 13.333333 / stageBounds.width], [y, (resized.y - stageBounds.y) * 7.5 / stageBounds.height], [w, resized.width * 13.333333 / stageBounds.width], [h, resized.height * 7.5 / stageBounds.height]]) {
    assert.ok(Math.abs(actual - expected) < 0.025, `exported geometry ${actual} differs from preview ${expected}`);
  }
  assert.match(slideXml, /<a:t>本周已核对 480 单<\/a:t>/);
  assert.match(slideXml, /<a:t>480 单<\/a:t>/);
  assert.doesNotMatch(await zip.file("ppt/slides/slide4.xml").async("string"), /<p:pic[ >]/);

  await remove.click();
  assert.equal(await figure.count(), 0);
  assert.equal(await canvas.getByRole("img").count(), 2);
  assert.equal(await frame.locator("#picture-status").textContent(), "");
  assert.equal(await canvas.locator(".slide").getAttribute("data-layout"), "metrics");
  const withoutPicture = page.waitForEvent("download");
  await frame.locator("#download").click();
  const removed = await JSZip.loadAsync(await readFile(await (await withoutPicture).path()));
  const remaining = await removed.file("ppt/slides/slide2.xml").async("string");
  assert.equal([...remaining.matchAll(/<p:pic[ >]/g)].length, 2);
  await vertical.focus();
  await vertical.press("Delete");
  assert.equal(await canvas.getByRole("img").count(), 1);
  assert.equal(await frame.locator("#picture-status").textContent(), "");
  assert.equal((await requests(frame)).length, 0);
});

browserCase("M6.1 restores independent generated drafts, including pictures, after refresh", async (page, frame) => {
  const menu = frame.locator("#library > summary");
  const list = frame.getByRole("list", { name: "保存的 PPT" });
  const selectDraft = name => list.getByRole("button", { name });
  const canvas = frame.locator("#stage");
  await frame.locator("#notes").fill("第一份稿件资料");
  await frame.locator("#page-count").fill("4");
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 4 页/ }).waitFor();
  await menu.click();
  await frame.getByText("当前 PPT 已保存", { exact: true }).waitFor();
  const summary = await menu.boundingBox();
  const arrow = await frame.locator(".library-chevron").boundingBox();
  assert.ok(Math.abs(summary.y + summary.height / 2 - arrow.y - arrow.height / 2) <= 3);
  await frame.getByRole("button", { name: "保存当前 PPT" }).click();
  assert.equal(await list.locator("li").count(), 1);
  await menu.click();
  await editSlideText(frame, "标题", "四页方案甲");
  await frame.locator("#ppt-theme").selectOption("technology");
  await frame.locator("#ppt-color").fill("#a438a6");
  const evidence = await picture(frame, "png", 58);
  await frame.locator("#picture-file").setInputFiles(evidence);
  const figure = canvas.getByRole("group", { name: evidence.name });
  await figure.waitFor();
  await figure.focus();
  await figure.press("ArrowLeft");
  const placement = await figure.boundingBox();

  await frame.locator("#notes").fill("第二份稿件资料");
  await frame.locator("#page-count").fill("6");
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  await frame.locator("#ppt-theme").selectOption("minimal");
  await frame.getByRole("button", { name: "恢复默认" }).click();
  await editSlideText(frame, "标题", "六页方案乙");
  assert.equal((await requests(frame)).length, 2);
  await menu.click();
  await selectDraft(/四页方案甲.*4 页/).click();
  await figure.waitFor();
  assert.deepEqual(await figure.boundingBox(), placement);
  assert.equal(await frame.locator("#ppt-theme").inputValue(), "technology");
  assert.equal(await frame.locator("#ppt-color").inputValue(), "#a438a6");
  await frame.locator("#ppt-color").fill("#d7ab79");
  await menu.click();
  await selectDraft(/六页方案乙.*6 页/).click();
  assert.equal(await frame.locator("#ppt-theme").inputValue(), "minimal");
  assert.equal(await canvas.getByRole("img").count(), 0);
  await menu.click();
  if (process.env.BRIEFDECK_M6_EVIDENCE) {
    await page.screenshot({ path: `${process.env.BRIEFDECK_M6_EVIDENCE}/02-save-current-ppt.png`, fullPage: true });
  }
  await frame.getByRole("button", { name: "新建空白" }).click();
  assert.ok(await frame.locator("#download").isDisabled());
  assert.equal(await frame.locator("#notes").inputValue(), "");
  assert.equal((await requests(frame)).length, 2);

  await page.reload();
  const reopened = page.frames().find(item => item.parentFrame());
  await reopened.locator("#library > summary").click();
  await reopened.getByRole("button", { name: /四页方案甲.*4 页/ }).click();
  const reopenedCanvas = reopened.locator("#stage");
  await reopenedCanvas.getByRole("img", { name: evidence.name }).waitFor();
  assert.equal(await reopened.locator("#ppt-color").inputValue(), "#d7ab79");
  assert.equal(await reopened.locator("#ppt-theme").inputValue(), "technology");
  const exporting = page.waitForEvent("download");
  await reopened.locator("#download").click();
  const zip = await JSZip.loadAsync(await readFile(await (await exporting).path()));
  assert.equal(zip.file(/^ppt\/slides\/slide\d+\.xml$/).length, 4);
  const first = await zip.file("ppt/slides/slide1.xml").async("string");
  assert.match(first, /四页方案甲/);
  assert.match(first, /<p:pic>/);
  assert.equal((await requests(reopened)).length, 0);
});

browserCase("M6.2 leaves sample saving explicit and retains in-memory drafts when storage is full", async (page, frame) => {
  const menu = frame.locator("#library > summary");
  const list = frame.getByRole("list", { name: "保存的 PPT" });
  await frame.getByRole("button", { name: "载入示例" }).click();
  await menu.click();
  await frame.getByText("还没有保存的 PPT。").waitFor();
  assert.equal(await list.getByRole("button").count(), 0);
  await frame.evaluate(() => { window.mockStorageFull = true; });
  await frame.getByRole("button", { name: "保存当前 PPT" }).click();
  await frame.locator("#library-status").filter({ hasText: /未能保存/ }).waitFor();
  await frame.getByRole("button", { name: "新建空白" }).click();
  await menu.click();
  await list.getByRole("button", { name: /客服工单分流试点.*6 页/ }).click();
  const exporting = page.waitForEvent("download");
  await frame.locator("#download").click();
  await exporting;
  assert.equal((await requests(frame)).length, 0);

  await page.goto(origin + "/bundle/index.html");
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.locator("#library > summary").click();
  await page.getByRole("button", { name: "保存当前 PPT" }).click();
  await page.waitForFunction(() => new Promise(resolve => {
    const open = indexedDB.open("briefdeck-library");
    open.onsuccess = () => {
      const database = open.result;
      const count = database.transaction("decks").objectStore("decks").count();
      count.onsuccess = () => {
        resolve(count.result === 1);
        database.close();
      };
    };
  }));
  await page.reload();
  await page.locator("#library > summary").click();
  await page.getByRole("button", { name: /客服工单分流试点.*6 页/ }).click();
  assert.match(await page.locator("#stage").innerText(), /客服工单分流试点/);
  await page.locator("#library > summary").click();
  await page.getByRole("button", { name: "删除 客服工单分流试点", exact: true }).click();
  await page.getByRole("dialog", { name: "删除 PPT" }).getByRole("button", { name: "删除", exact: true }).click();
  await page.getByText("还没有保存的 PPT。").waitFor();
  assert.ok(await page.locator("#download").isDisabled());
});

browserCase("M6.3 deletes only the confirmed draft and retains it if storage rejects the deletion", async (page, frame) => {
  const menu = frame.locator("#library > summary");
  const list = frame.getByRole("list", { name: "保存的 PPT" });
  const confirmation = frame.getByRole("dialog", { name: "删除 PPT" });
  await frame.locator("#notes").fill("生成后保留两份稿件");
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  await editSlideText(frame, "标题", "保留的稿件");
  await submit(frame);
  await status(frame).filter({ hasText: /已生成 6 页/ }).waitFor();
  await editSlideText(frame, "标题", "待删除的稿件");
  await menu.click();
  await frame.getByText("当前 PPT 已保存", { exact: true }).waitFor();
  const remove = list.getByRole("button", { name: "删除 待删除的稿件" });
  await remove.click();
  await confirmation.getByRole("button", { name: "取消" }).click();
  assert.equal(await list.locator("li").count(), 2);
  await frame.evaluate(() => { window.mockDeleteFailure = true; });
  await remove.click();
  await confirmation.getByRole("button", { name: "删除", exact: true }).click();
  await frame.getByText("未能删除这份 PPT。稿件仍保留，可以稍后重试。").waitFor();
  assert.equal(await list.locator("li").count(), 2);
  assert.match(await frame.locator("#stage").innerText(), /待删除的稿件/);
  await frame.evaluate(() => { window.mockDeleteFailure = false; });
  await remove.click();
  await confirmation.getByRole("button", { name: "删除", exact: true }).click();
  await remove.waitFor({ state: "detached" });
  assert.ok(await frame.locator("#download").isDisabled());
  assert.equal((await requests(frame)).length, 2);
  await page.reload();
  const restored = page.frames().find(item => item.parentFrame());
  await restored.locator("#library > summary").click();
  await restored.getByRole("button", { name: /保留的稿件.*6 页/ }).waitFor();
  assert.equal(await restored.getByRole("button", { name: /待删除的稿件/ }).count(), 0);
  assert.equal((await requests(restored)).length, 0);
});

browserCase("M3.1, M4.1 and M4.2 keep preview, paging and actual downloads consistent", async (page, frame) => {
  await frame.getByRole("button", { name: "载入示例" }).click();
  const sampleDownload = page.waitForEvent("download");
  await frame.locator("#download").click();
  await sampleDownload;
  assert.equal((await requests(frame)).length, 0);
  for (const count of [4, 9, 12]) {
    await frame.locator("#page-count").fill(String(count));
    await submit(frame, true);
    await status(frame).filter({ hasText: new RegExp(`已生成 ${count} 页`) }).waitFor();
    assert.equal(await frame.locator("#pages button").count(), count);
    await frame.getByRole("button", { name: `第 ${count} 页`, exact: true }).click();
    await editSlideText(frame, "标题", "最后一页修改");
    await frame.getByRole("button", { name: "封面", exact: true }).click();
    await frame.getByRole("button", { name: `第 ${count} 页`, exact: true }).click();
    assert.match(await frame.locator("#stage").innerText(), /最后一页修改/);
    assert.equal(await frame.locator("#position").innerText(), `第 ${count} / ${count} 页`);
    await frame.locator("#page-count").fill("5");
    assert.equal(await frame.locator("#pages button").count(), count);
    const downloaded = page.waitForEvent("download");
    await frame.locator("#download").click();
    const path = await (await downloaded).path();
    const ppt = await JSZip.loadAsync(await readFile(path));
    assert.equal(ppt.file(/^ppt\/slides\/slide\d+\.xml$/).length, count);
    assert.match(await ppt.file(`ppt/slides/slide${count}.xml`).async("string"), /<a:t>最后一页修改<\/a:t>/);
  }
  await frame.evaluate(() => { window.mockOutcome = "long"; });
  await submit(frame, true);
  await status(frame).filter({ hasText: /已生成 5 页/ }).waitFor();
  await frame.getByRole("button", { name: "第 2 页", exact: true }).click();
  for (const width of [1200, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const unclipped = await frame.locator(".slide-text").evaluateAll(elements => elements.every(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return text.top >= box.top - 1 && text.bottom <= box.bottom + 1 && text.right <= box.right + 1;
    }));
    assert.ok(unclipped, `text should fit at ${width}px`);
  }
  await frame.evaluate(() => { window.RealPptx = window.PptxGenJS; window.PptxGenJS = null; });
  await frame.locator("#download").click();
  await status(frame).filter({ hasText: /导出失败/ }).waitFor();
  assert.match(await frame.locator("#stage").innerText(), /题题题/);
  await frame.evaluate(() => { window.PptxGenJS = window.RealPptx; });
  const retried = page.waitForEvent("download");
  await frame.locator("#download").click();
  await retried;
});
