import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { chromium } from "playwright-core";

const destination = new URL("../release/staging-fixture/", import.meta.url);
await mkdir(destination, { recursive: true });
const zip = new JSZip();
zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
const paragraphs = [
  "客服工单分流试点周报",
  "目标是在保留人工复核的前提下缩短首次响应。试点覆盖 2 个业务组，本周处理 480 单，人工复核覆盖率为 100%。",
  "已完成知识库标签映射和分流规则测试，监控页已支持按业务组查看响应时间。",
  "夜间班次样本偏少，效果仍待验证。请团队补做夜班抽样并复核错分原因。",
  "是否加入第 3 个业务组仍待项目负责人决策。建议先核对夜班结果，再安排扩容。扩容日期未定。"
];
zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(value => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
await writeFile(new URL("weekly-report.docx", destination), await zip.generateAsync({ type: "nodebuffer" }));

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath = process.env.BRIEFDECK_CHROMIUM || (existsSync(chrome) ? chrome : undefined);
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 832, height: 400 } });
  await page.setContent(`
    <!doctype html><html lang="zh-CN">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px; background: #eaf0e9; color: #18362d; font-family: "Microsoft YaHei", sans-serif; }
      main { padding: 28px 32px; border-radius: 15px; background: #fff; }
      h1 { margin: 0; font-size: 34px; } p { margin: 10px 0 23px; font-size: 18px; }
      .row { display: grid; grid-template-columns: 110px 1fr; align-items: center; gap: 12px; margin: 15px 0; font-size: 20px; font-weight: 600; }
      .bar { padding: 8px 12px; color: white; border-radius: 5px; background: #27624c; }
      .before { width: 360px; } .after { width: 220px; }
      footer { font-size: 16px; color: #375d50; }
    </style>
    <main>
      <h1>客服试点监控</h1>
      <p>首次响应时间中位数</p>
      <div class="row"><span>试点前</span><div class="bar before">18 分钟</div></div>
      <div class="row"><span>试点本周</span><div class="bar after">11 分钟</div></div>
      <footer>数据范围为试点业务组。夜班数据仍待复核。</footer>
    </main>`);
  await page.screenshot({ path: fileURLToPath(new URL("response-metrics.png", destination)) });
} finally {
  await browser.close();
}
