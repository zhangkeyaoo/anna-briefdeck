import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import JSZip from "jszip";
import { chromium } from "playwright-core";
import { sampleDeck } from "../bundle/deck.js";

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
      window.requests = [];
      export const AnnaAppRuntime = { async connect() {
        if (window.mockConnectionFailure) throw Error("network");
        return { llm: { async complete(request) {
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
          const result = Array.from({ length: count }, (_, i) => structuredClone(slides[i % 6]));
          if (window.mockOutcome === "count") result.pop();
          if (window.mockOutcome === "long") result[1] = { title: "题".repeat(28), points: Array(3).fill("文".repeat(56)) };
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
  if (confirm) await frame.getByRole("button", { name: "继续" }).click();
}

async function picture(frame, format, width = 360) {
  const data = await frame.evaluate(({ format, width }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    context.font = "24px sans-serif";
    context.fillText("18 min → 11 min", 20, 60);
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
  await frame.getByLabel("要点 1").fill("编辑后保留");
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
    await frame.getByLabel("标题", { exact: true }).fill("最后一页修改");
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
