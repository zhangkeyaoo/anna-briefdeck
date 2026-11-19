const maxPages = 50;
let engine;
let packedAssets;

class PdfAssets {
  async fetch({ kind, filename }) {
    packedAssets ??= fetch(new URL("./vendor/pdf-text-assets.json", import.meta.url)).then(response => {
      if (!response.ok) throw new Error("PDF 字体映射资源不可用");
      return response.json();
    }).catch(error => {
      packedAssets = undefined;
      throw error;
    });
    const assets = (await packedAssets)[kind];
    if (!assets || !Object.hasOwn(assets, filename)) throw new Error("PDF 字体映射不存在");
    return Uint8Array.from(atob(assets[filename]), character => character.charCodeAt(0));
  }
}

function pageText(items, viewport) {
  const positioned = items.filter(item => item.str?.trim()).map(item => {
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    return { x, y, str: item.str, width: item.width, height: item.height };
  }).sort((a, b) => a.y - b.y);
  const lines = [];
  for (const item of positioned) {
    const previous = lines.at(-1);
    if (previous && item.y - previous.y <= Math.max(1.5, Math.min(4, item.height * 0.25))) {
      previous.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  return lines.map(line => {
    let right;
    let text = "";
    for (const item of line.items.sort((a, b) => a.x - b.x)) {
      if (right !== undefined && item.x - right > Math.max(1, item.height * 0.18) &&
          !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
      text += item.str;
      right = item.x + item.width;
    }
    return text.trim();
  }).filter(Boolean).join("\n");
}

export async function readPdf(file, maxTextLength) {
  let pdfjs;
  try {
    engine ??= import("./vendor/pdf.min.js");
    pdfjs = await engine;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.js", import.meta.url).href;
  } catch {
    engine = undefined;
    throw new Error("PDF 读取组件加载失败，请刷新后重试。");
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    BinaryDataFactory: PdfAssets, useWorkerFetch: false, useWasm: false,
    stopAtErrors: true, enableXfa: false
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPages) throw new PdfInputError(`PDF 不能超过 ${maxPages} 页，请拆分后再添加。`);
    if (await pdf.getPermissions() !== null) throw new PdfInputError("PDF 已加密，请先解除保护后再添加。");
    const pages = [];
    const missing = [];
    let length = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const { items } = await page.getTextContent();
      const text = pageText(items, page.getViewport({ scale: 1 }));
      page.cleanup();
      if (text) {
        const section = `第 ${index} 页\n${text}`;
        length += section.length + (pages.length ? 2 : 0);
        if (length > maxTextLength) throw new PdfInputError(`PDF 提取的文字超过 ${maxTextLength.toLocaleString("zh-CN")} 字，请拆分或缩短。`);
        pages.push(section);
      } else {
        missing.push(index);
      }
    }
    if (!pages.length) throw new PdfInputError("PDF 没有可提取的文字。扫描件请先做文字识别。");
    return {
      text: pages.join("\n\n"),
      ...(missing.length ? { warning: `第 ${missing.join("、")} 页没有可提取的文字，已跳过。` } : {})
    };
  } catch (error) {
    if (error instanceof PdfInputError) throw error;
    if (error?.name === "PasswordException") throw new Error("PDF 已加密，请先解除保护后再添加。");
    throw new Error("无法读取 PDF。请检查文件是否损坏，或重新导出后添加。");
  } finally {
    await task.destroy().catch(() => {});
  }
}

class PdfInputError extends Error {}
