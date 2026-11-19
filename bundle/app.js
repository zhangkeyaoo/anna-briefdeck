import { defaultPages, limits, makeRequest, parseDeck, sampleAudience, sampleDeck, sampleNotes, validPageCount } from "./deck.js";
import { dimensions, slideLayout } from "./layout.js";
import { createPresentation, fileName } from "./export.js";
import { readSource, sourceKind, sourceLimits } from "./sources.js";

const find = id => document.getElementById(id);
const form = find("brief-form");
const notes = find("notes");
const audience = find("audience");
const pageCount = find("page-count");
const pageCountError = find("page-count-error");
const fileInput = find("sources");
const sourceDetails = find("source-details");
const sourceSummary = find("source-summary");
const sourceList = find("source-list");
const stage = find("stage");
const pages = find("pages");
const fields = find("fields");
const fieldList = find("field-list");
const generate = find("generate");
const example = find("example");
const download = find("download");
const status = find("status");
const replaceDialog = find("replace-dialog");
const params = new URLSearchParams(location.search);
const hosted = window.parent !== window && params.has("wid") && params.has("t");
let runtimePromise;
let deck;
let selected = 0;
let busy = false;
let sources = [];
let lastPageInput = pageCount.value;

function showPageCountError(message) {
  pageCountError.textContent = message;
  pageCountError.hidden = !message;
  pageCount.setAttribute("aria-invalid", String(Boolean(message)));
}

function checkPageCount() {
  const value = pageCount.value;
  if (!/^[0-9]*$/.test(value)) {
    pageCount.value = lastPageInput;
    showPageCountError("只能输入整数，已保留原值。");
    return;
  }
  lastPageInput = value;
  if (!value) {
    showPageCountError("请输入页数。");
  } else if (!validPageCount(Number(value))) {
    showPageCountError(`请输入 ${limits.minPages}–${limits.maxPages} 页。`);
  } else {
    showPageCountError("");
  }
}

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function formatUsage(response) {
  const consumed = response?._meta?.quotaConsumed;
  const effectiveCap = response?._meta?.maxTokens?.effective;
  const outputTokens = response?.usage?.outputTokens;
  const details = [];
  if (Number.isFinite(consumed)) details.push(`本次消耗 ${consumed} CU`);
  if (Number.isFinite(outputTokens)) details.push(`输出 ${outputTokens} tokens`);
  if (Number.isFinite(effectiveCap)) details.push(`输出上限 ${effectiveCap} tokens`);
  return details.length ? details.join("，") + "。" : "";
}

function textLength() {
  return notes.value.trim().length + sources.reduce((total, source) => total + (source.text?.length ?? 0), 0);
}

function updateLength() {
  const length = textLength();
  const counter = find("length");
  counter.textContent = `文字 ${length} / ${limits.text}`;
  counter.dataset.kind = length > limits.text ? "error" : "info";
}

function renderSources() {
  sourceDetails.hidden = sources.length === 0;
  if (!sources.length) sourceDetails.open = false;
  const failed = sources.filter(source => source.state === "error").length;
  const reading = sources.filter(source => source.state === "reading").length;
  const summaryParts = [`已添加 ${sources.length} 个文件`];
  if (reading) summaryParts.push(`${reading} 个读取中`);
  if (failed) summaryParts.push(`${failed} 个需处理`);
  sourceSummary.textContent = summaryParts.join(" · ");
  sourceSummary.dataset.kind = failed ? "error" : "info";
  sourceList.replaceChildren(...sources.map(source => {
    const row = document.createElement("li");
    row.dataset.state = source.state;
    const line = document.createElement("div");
    line.className = "source-line";
    const label = document.createElement("span");
    label.textContent = source.file.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "移除";
    remove.setAttribute("aria-label", `移除 ${source.file.name}`);
    remove.addEventListener("click", () => {
      sources = sources.filter(item => item !== source);
      renderSources();
    });
    line.append(label, remove);
    const state = document.createElement("p");
    state.textContent = source.error ?? (source.state === "reading" ? "读取中…" : source.text ? `已提取 ${source.text.length} 个字符` : "图片已就绪");
    row.append(line, state);
    if (source.preview) row.append(source.preview);
    if (source.text) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "查看提取文字";
      const text = document.createElement("p");
      text.textContent = source.text;
      details.append(summary, text);
      row.append(details);
    }
    return row;
  }));
  updateLength();
}

async function addSource(file) {
  const kind = sourceKind(file.name);
  const group = kind === "image" ? "image" : "document";
  const count = sources.filter(source => source.group === group && source.state !== "error").length;
  const source = { file, group, state: "reading" };
  sources.push(source);
  try {
    if (!kind) throw new Error("支持 DOCX、TXT、PNG 和 JPEG。");
    if (count >= sourceLimits.perKind) throw new Error(group === "image" ? "最多添加 2 张图片。" : "最多添加 2 份文档。");
    renderSources();
    Object.assign(source, await readSource(file, kind), { state: "ready" });
  } catch (error) {
    source.state = "error";
    source.error = error instanceof Error ? error.message : "文件读取失败。";
    if (sources.includes(source)) sourceDetails.open = true;
  }
  renderSources();
}

function confirmReplace(message) {
  replaceDialog.returnValue = "cancel";
  find("replace-message").textContent = message;
  return new Promise(resolve => {
    replaceDialog.addEventListener("close", () => resolve(replaceDialog.returnValue === "replace"), { once: true });
    replaceDialog.showModal();
  });
}

function renderSlide() {
  const layout = slideLayout(deck.slides[selected], selected, deck.slides.length);
  const preview = document.createElement("div");
  preview.className = "slide";
  preview.style.backgroundColor = "#" + layout.background;
  for (const item of layout.elements) {
    const element = document.createElement("div");
    element.className = item.kind === "text" ? "slide-text" : "slide-shape";
    element.style.left = `${item.x / dimensions.width * 100}%`;
    element.style.top = `${item.y / dimensions.height * 100}%`;
    element.style.width = `${item.w / dimensions.width * 100}%`;
    element.style.height = `${item.h / dimensions.height * 100}%`;
    if (item.kind === "text") {
      element.style.fontSize = `${item.size / (dimensions.width * 72) * 100}cqw`;
      element.style.color = "#" + item.color;
      element.style.fontWeight = item.bold ? "700" : "400";
      element.textContent = item.value;
    } else {
      element.style.backgroundColor = "#" + item.color;
    }
    preview.append(element);
  }
  stage.removeAttribute("data-empty");
  stage.replaceChildren(preview);
}

function editField(label, value, maxLength, onChange) {
  const field = document.createElement("label");
  const labelText = document.createElement("span");
  labelText.textContent = label;
  const input = document.createElement("input");
  input.value = value;
  input.maxLength = maxLength;
  input.addEventListener("input", () => {
    onChange(input.value);
    renderSlide();
  });
  field.append(labelText, input);
  return field;
}

function selectPage(index) {
  selected = index;
  [...pages.children].forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  find("position").textContent = `第 ${index + 1} / ${deck.slides.length} 页`;
  const slide = deck.slides[index];
  fieldList.replaceChildren(
    editField("标题", slide.title, limits.title, value => { slide.title = value; }),
    ...slide.points.map((point, i) => editField(
      index === 0 ? "副标题" : `要点 ${i + 1}`, point, limits.point,
      value => { slide.points[i] = value; }
    ))
  );
  renderSlide();
}

function openDeck(newDeck) {
  deck = newDeck;
  pages.replaceChildren(...deck.slides.map((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = index === 0 ? "封面" : `第 ${index + 1} 页`;
    button.title = slide.title;
    button.addEventListener("click", () => selectPage(index));
    return button;
  }));
  pages.hidden = false;
  fields.hidden = false;
  download.disabled = false;
  selectPage(0);
}

function getRuntime() {
  runtimePromise ??= import("/static/anna-apps/_sdk/latest/index.js")
    .then(({ AnnaAppRuntime }) => AnnaAppRuntime.connect())
    .catch(error => {
      runtimePromise = undefined;
      throw error;
    });
  return runtimePromise;
}

if (hosted) getRuntime().catch(() => {
  if (!busy && !deck) setStatus("Anna 连接暂不可用，仍可载入示例。", "error");
});

notes.addEventListener("input", updateLength);
pageCount.addEventListener("input", checkPageCount);
find("pick-sources").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  for (const file of fileInput.files) void addSource(file);
  fileInput.value = "";
});
example.addEventListener("click", async () => {
  if (busy || replaceDialog.open) return;
  if ((notes.value.trim() && notes.value !== sampleNotes || sources.length || deck) &&
      !await confirmReplace("载入示例会替换当前资料和幻灯片。")) return;
  audience.value = sampleAudience;
  notes.value = sampleNotes;
  pageCount.value = defaultPages;
  checkPageCount();
  sources = [];
  renderSources();
  openDeck(structuredClone(sampleDeck));
  setStatus("已载入示例。你可以直接修改和下载。");
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || replaceDialog.open) return;
  const count = Number(pageCount.value);
  if (!pageCountError.hidden || !/^[0-9]+$/.test(pageCount.value) || !validPageCount(count)) {
    if (pageCountError.hidden) checkPageCount();
    pageCount.focus();
    return;
  }
  if (sources.some(source => source.state === "reading")) {
    setStatus("资料仍在读取，请等待读取完成。", "error");
    return;
  }
  if (sources.some(source => source.state === "error")) {
    sourceDetails.open = true;
    setStatus("请先移除读取失败的文件，或重新添加有效文件。", "error");
    return;
  }
  const excess = textLength() - limits.text;
  if (excess > 0) {
    setStatus(`资料文字超过上限，请减少至少 ${excess} 个字符。`, "error");
    return;
  }
  if (!notes.value.trim() && !sources.length) {
    setStatus("请粘贴笔记或添加至少一份资料。", "error");
    return;
  }
  if (!hosted) {
    setStatus("请在 Anna 中打开应用以使用 AI 生成。当前可试用示例。", "error");
    return;
  }
  if (deck && !await confirmReplace("生成成功后会替换当前幻灯片。")) return;
  const images = sources.filter(source => source.image).map(source => source.image);
  const documents = sources.filter(source => source.text).map(source => ({ name: source.file.name, text: source.text }));
  const request = makeRequest({ notes: notes.value, audience: audience.value, pageCount: count, documents, images });
  busy = true;
  generate.disabled = true;
  example.disabled = true;
  setStatus("Anna 正在整理汇报，通常需要几秒到几十秒。");
  let usage = "";
  try {
    const anna = await getRuntime();
    const response = await anna.llm.complete(request);
    usage = formatUsage(response);
    openDeck(parseDeck(response, count));
    const review = images.length ? "请核对从图片读取的数字。" : "";
    setStatus(`已生成 ${count} 页。${usage}${review}`, "success");
  } catch (error) {
    const code = [error?.data?.errorCode, error?.data?.code, error?.code, error?.message].join(" ");
    if (/APP_MODEL_NOT_VISION_CAPABLE/i.test(code)) {
      setStatus("当前 Anna 模型无法读取图片。请换用支持视觉的模型，或移除图片后再试。", "error");
    } else if (/quota|429|credit|insufficient/i.test(code)) {
      setStatus("Anna 额度不足，请检查余额后再试。已有稿件仍可编辑和下载。", "error");
    } else {
      const detail = error instanceof Error && /^Anna |^第 /.test(error.message) ? error.message : "无法连接 Anna 或生成暂时失败，可以稍后手动重试。";
      setStatus(detail + usage, "error");
    }
  } finally {
    busy = false;
    generate.disabled = false;
    example.disabled = false;
  }
});

download.addEventListener("click", async () => {
  if (!deck || download.disabled) return;
  download.disabled = true;
  try {
    if (!window.PptxGenJS) throw new Error("PPTX 组件未加载");
    const presentation = createPresentation(deck, window.PptxGenJS);
    await presentation.writeFile({ fileName: fileName(deck.slides[0].title) });
    setStatus("已生成 PPTX，文件中保留可编辑文字和形状。", "success");
  } catch {
    setStatus("导出失败，请再次点击下载。现有稿件已保留。", "error");
  } finally {
    download.disabled = false;
  }
});
