import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import JSZip from "jszip";
import { chromium } from "playwright-core";
import { sampleDeck } from "../bundle/deck.js";
import { archiveMigration, supportPilot } from "./slide-design-fixtures.mjs";

const origin = "https://briefdeck.test";
const types = { html: "text/html", js: "text/javascript", css: "text/css" };
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
let browser;
let wordBuffer;

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
    return route.fulfill({ contentType: "text/html", body: '<style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" src="/bundle/index.html?wid=test&t=test"></iframe>' });
  }
  if (pathname === "/static/anna-apps/_sdk/latest/index.js") {
    return route.fulfill({ contentType: "text/javascript", body: `
      const slides = ${JSON.stringify(sampleDeck.slides)};
      const designFixtures = ${JSON.stringify([supportPilot, archiveMigration])};
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
          const count = Number(input.text.match(/恰好 ([0-9]+) 页/)[1]);
          if (window.holdMockResponse) {
            await new Promise(resolve => { window.releaseMockResponse = resolve; });
          } else {
            await new Promise(resolve => setTimeout(resolve, 70));
          }
          if (window.mockOutcome === "quota") throw { code: "quota_exceeded" };
          if (window.mockOutcome === "vision") throw { data: { errorCode: "APP_MODEL_NOT_VISION_CAPABLE" } };
          if (window.mockOutcome === "network") throw Error("network");
          if (window.mockOutcome === "cut") return {
            stopReason: "maxTokens",
            usage: { outputTokens: 1500 },
            _meta: { quotaConsumed: 14, maxTokens: { effective: 1500 } }
          };
          if (window.mockOutcome === "json") return { ...response, content: { text: "broken" } };
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
    [file("broken.png"), /图片内容与格式不符/], [file("test.pdf"), /支持 DOCX/],
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
    ["quota", /额度不足/], ["vision", /无法读取图片/], ["network", /无法连接 Anna/]
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
      assert.match(message, /本次消耗 14 CU/);
      assert.match(message, /输出上限 1500 tokens/);
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
  assert.match(await status(frame).textContent(), /25\.27 CU.*mock-vision.*输入 900 tokens.*输出 2988 tokens.*推理 2200 tokens/);
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
    assert.match(slideXml, expected);
    assert.equal([...slideXml.matchAll(/<p:pic>/g)].length, pictureCount);
  };
  await assertDownload(/<a:t>后  12 分钟<\/a:t>/, "m5-pilot", 1);
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
  await assertDownload(/<a:t>11 月 30 日，核对结果后切换。<\/a:t>/, "m5-migration");
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
  assert.equal(request.maxTokens, 1800);
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
