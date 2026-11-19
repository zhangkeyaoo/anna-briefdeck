import { limits, makeRequest, parseDeck, sampleAudience, sampleDeck, sampleNotes, sections } from "./deck.js";
import { dimensions, slideLayout } from "./layout.js";
import { createPresentation, fileName } from "./export.js";

const find = id => document.getElementById(id);
const form = find("brief-form");
const notes = find("notes");
const audience = find("audience");
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

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function updateLength() {
  find("length").textContent = `${notes.value.length} / 4000`;
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
  const layout = slideLayout(deck.slides[selected], selected, sections[selected], deck.slides.length);
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
  pages.replaceChildren(...sections.map((name, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
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
example.addEventListener("click", async () => {
  if (busy || replaceDialog.open) return;
  if ((notes.value.trim() && notes.value !== sampleNotes || deck) &&
      !await confirmReplace("载入示例会替换当前笔记和幻灯片。")) return;
  audience.value = sampleAudience;
  notes.value = sampleNotes;
  updateLength();
  openDeck(structuredClone(sampleDeck));
  setStatus("已载入示例。你可以直接修改和下载。");
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || replaceDialog.open) return;
  if (!hosted) {
    setStatus("请在 Anna 中打开应用以使用 AI 生成。当前可试用示例。", "error");
    return;
  }
  if (notes.value.trim().length < 10) {
    setStatus("请填写至少 10 个字符的项目笔记。", "error");
    return;
  }
  if (deck && !await confirmReplace("生成成功后会替换当前幻灯片。")) return;
  busy = true;
  generate.disabled = true;
  example.disabled = true;
  setStatus("Anna 正在整理汇报，通常需要几秒到几十秒。");
  try {
    const anna = await getRuntime();
    const response = await anna.llm.complete(makeRequest(notes.value, audience.value));
    openDeck(parseDeck(response));
    const consumed = response._meta?.quotaConsumed;
    setStatus(Number.isFinite(consumed) ? `已生成六页 · 本次消耗 ${consumed} CU` : "已生成六页，点击页签可修改。", "success");
  } catch (error) {
    const code = String(error?.data?.errorCode ?? error?.code ?? "");
    if (/quota|429|credit|insufficient/i.test(code)) {
      setStatus("Anna 额度不足，请检查余额后再试。已有稿件仍可编辑和下载。", "error");
    } else {
      const detail = error instanceof Error && /^Anna |^第 /.test(error.message) ? error.message : "Anna 暂时无法生成。可以稍后手动重试。";
      setStatus(detail, "error");
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
