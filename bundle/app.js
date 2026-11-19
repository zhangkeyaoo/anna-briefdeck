import { defaultPages, limits, makeRequest, parseDeck, sampleAudience, sampleDeck, sampleNotes, validPageCount } from "./deck.js";
import { dimensions, movePicture, pictureElement, placePicture, resizePicture, slideLayout, themePalette } from "./layout.js";
import { createPresentation, fileName } from "./export.js";
import { readSlidePicture, readSource, sourceKind, sourceLimits } from "./sources.js";
import { annaLibrary, browserLibrary, restoreDraft, snapshotDraft } from "./library.js";

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
const theme = find("ppt-theme");
const color = find("ppt-color");
const resetColor = find("reset-color");
const instructions = find("ppt-instructions");
const stage = find("stage");
const pages = find("pages");
const editHint = find("edit-hint");
const pictureControls = find("picture-controls");
const pictureFile = find("picture-file");
const insertPicture = find("insert-picture");
const picturePicker = find("picture-picker");
const pictureHint = find("picture-hint");
const pictureStatus = find("picture-status");
const generate = find("generate");
const example = find("example");
const download = find("download");
const status = find("status");
const replaceDialog = find("replace-dialog");
const library = find("library");
const draftList = find("draft-list");
const newDraft = find("new-draft");
const saveExample = find("save-example");
const libraryStatus = find("library-status");
const emptyStage = stage.firstElementChild;
const params = new URLSearchParams(location.search);
const hosted = window.parent !== window && params.has("wid") && params.has("t");
let runtimePromise;
let deck;
let selected = 0;
let selectedPicture;
let busy = false;
let sources = [];
let lastPageInput = pageCount.value;
let customColor = "";
let exporting = false;
const pendingPictures = new Set();
const drafts = new Map();
const failedDrafts = new Set();
const pendingSaves = new Map();
const draftStorage = hosted ? annaLibrary(getRuntime) : browserLibrary;
const draftTime = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
let activeDraft;
let openingDraft = false;
let loadingLibrary = true;
let libraryReadFailed = false;

function slideStyle() {
  return { theme: theme.value, accent: customColor };
}

function updateSlideStyle() {
  color.value = "#" + themePalette(theme.value, customColor).accent.toLowerCase();
  resetColor.hidden = !customColor;
  if (deck) renderSlide();
}

function renderLibrary() {
  const disabled = busy || exporting || openingDraft || loadingLibrary || Boolean(deck?.slides.some(slide => pendingPictures.has(slide)));
  newDraft.disabled = disabled;
  saveExample.hidden = !deck || Boolean(activeDraft);
  saveExample.disabled = disabled;
  find("library-empty").hidden = loadingLibrary || Boolean(drafts.size);
  const records = [...drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  draftList.replaceChildren(...records.map(record => {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "draft-entry";
    button.disabled = disabled;
    if (record.id === activeDraft) button.setAttribute("aria-current", "true");
    const title = document.createElement("span");
    title.className = "draft-title";
    title.textContent = record.title || "未命名 PPT";
    const meta = document.createElement("span");
    meta.className = "draft-detail";
    meta.textContent = `${record.pageCount} 页 · ${draftTime.format(record.updatedAt)}${record.id === activeDraft ? " · 当前" : ""}`;
    button.append(title, meta);
    button.addEventListener("click", () => openDraft(record.id));
    row.append(button);
    return row;
  }));
}

function showLibraryError(message) {
  libraryStatus.textContent = message;
  libraryStatus.hidden = !message;
}

function saveCurrentDraft() {
  if (!activeDraft || !deck) return;
  const record = snapshotDraft(activeDraft, deck, slideStyle());
  drafts.set(record.id, record);
  renderLibrary();
  const queued = (pendingSaves.get(record.id) ?? Promise.resolve()).catch(() => {}).then(() => {
    if (drafts.get(record.id) === record) return draftStorage.save(record);
  });
  pendingSaves.set(record.id, queued);
  void queued.then(() => {
    if (drafts.get(record.id) !== record) return;
    failedDrafts.delete(record.id);
    if (!libraryReadFailed && !failedDrafts.size) showLibraryError("");
  }, () => {
    if (drafts.get(record.id) !== record) return;
    failedDrafts.add(record.id);
    showLibraryError("有稿件未能保存。当前窗口仍可使用，请下载 PPTX 后再关闭。");
  }).finally(() => {
    if (pendingSaves.get(record.id) === queued) pendingSaves.delete(record.id);
  });
}

function clearBrief(count = defaultPages, style = { theme: "minimal", accent: "" }) {
  form.reset();
  sources = [];
  renderSources();
  pageCount.value = String(count);
  checkPageCount();
  theme.value = style.theme;
  customColor = style.accent;
  color.value = "#" + themePalette(theme.value, customColor).accent.toLowerCase();
  resetColor.hidden = !customColor;
}

function closeLibrary() {
  library.open = false;
  library.querySelector("summary").focus();
}

async function openDraft(id) {
  if (id === activeDraft) {
    closeLibrary();
    return;
  }
  finishCurrentTextEdit();
  const entry = drafts.get(id);
  openingDraft = true;
  renderLibrary();
  try {
    const record = entry.deck ? entry : await draftStorage.get(id);
    const saved = await restoreDraft(record);
    clearBrief(saved.slides.length, record.style);
    openDeck(saved, id);
    setStatus("");
    closeLibrary();
  } catch {
    showLibraryError("这份稿件暂时无法打开。当前稿件已保留。");
  } finally {
    openingDraft = false;
    renderLibrary();
  }
}

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
  const inputTokens = response?.usage?.inputTokens;
  const outputTokens = response?.usage?.outputTokens;
  const reasoningTokens = response?.usage?.reasoningTokens;
  const details = [];
  if (Number.isFinite(consumed)) {
    const display = consumed > 0 && consumed < 0.01 ? "<0.01" : String(Math.round(consumed * 100) / 100);
    details.push(`本次消耗 ${display} CU`);
  }
  if (typeof response?.model === "string" && response.model) details.push(`模型 ${response.model}`);
  if (Number.isFinite(inputTokens)) details.push(`输入 ${inputTokens} tokens`);
  if (Number.isFinite(outputTokens)) details.push(`输出 ${outputTokens} tokens`);
  if (Number.isFinite(reasoningTokens)) details.push(`其中推理 ${reasoningTokens} tokens`);
  if (response?._meta?.thinking?.effective?.enabled === true && !Number.isFinite(reasoningTokens)) {
    details.push("模型启用了推理，未返回推理用量");
  }
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

function paintSlideElement(element, item) {
  element.style.left = `${item.x / dimensions.width * 100}%`;
  element.style.top = `${item.y / dimensions.height * 100}%`;
  element.style.width = `${item.w / dimensions.width * 100}%`;
  element.style.height = `${item.h / dimensions.height * 100}%`;
  if (item.kind === "text") {
    element.style.fontSize = `${item.size / (dimensions.width * 72) * 100}cqw`;
    element.style.color = "#" + item.color;
    element.style.fontWeight = item.bold ? "700" : "400";
    element.textContent = item.value;
  } else if (item.kind === "image") {
    if (element.firstChild !== item.picture.preview) element.replaceChildren(item.picture.preview);
  } else {
    element.style.backgroundColor = "#" + item.color;
  }
}

function selectPicture(picture) {
  selectedPicture = picture;
  const slide = deck.slides[selected];
  stage.querySelectorAll(".slide-picture").forEach((element, index) => {
    element.dataset.selected = String(slide.pictures[index] === picture);
  });
  picturePicker.value = picture ? String(slide.pictures.indexOf(picture)) : "";
  pictureHint.hidden = !picture;
}

function removeSlidePicture(picture) {
  finishCurrentTextEdit();
  const slide = deck.slides[selected];
  slide.pictures = slide.pictures.filter(item => item !== picture);
  selectedPicture = undefined;
  renderSlide();
  updatePictureControls();
  saveCurrentDraft();
  insertPicture.focus();
}

function enablePictureEditing(preview, element, picture) {
  const handle = document.createElement("span");
  handle.className = "picture-resize";
  handle.setAttribute("aria-hidden", "true");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "picture-remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `移除图片 ${picture.name}`);
  remove.addEventListener("click", () => removeSlidePicture(picture));
  picture.preview.setAttribute("role", "img");
  picture.preview.setAttribute("aria-label", picture.name);
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", picture.name);
  element.append(handle, remove);
  element.tabIndex = 0;
  element.dataset.selected = String(selectedPicture === picture);
  let drag;
  function updateFrame(transform, origin, dx, dy) {
    picture.frame = transform(origin, dx, dy);
    paintSlideElement(element, pictureElement(picture));
  }
  element.addEventListener("focus", () => selectPicture(picture));
  element.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target === remove || drag) return;
    event.preventDefault();
    finishCurrentTextEdit();
    element.focus({ preventScroll: true });
    selectPicture(picture);
    drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY, origin: picture.frame,
      transform: event.target === handle ? resizePicture : movePicture
    };
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener("pointermove", event => {
    if (event.pointerId !== drag?.id) return;
    const bounds = preview.getBoundingClientRect();
    updateFrame(drag.transform, drag.origin,
      (event.clientX - drag.x) * dimensions.width / bounds.width,
      (event.clientY - drag.y) * dimensions.height / bounds.height);
  });
  element.addEventListener("lostpointercapture", () => {
    if (drag && drag.origin !== picture.frame) saveCurrentDraft();
    drag = undefined;
  });
  element.addEventListener("keydown", event => {
    if (event.target !== element) return;
    if (event.key === "Delete") {
      event.preventDefault();
      removeSlidePicture(picture);
      return;
    }
    const delta = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[event.key];
    if (!Array.isArray(delta)) return;
    event.preventDefault();
    selectPicture(picture);
    updateFrame(event.shiftKey ? resizePicture : movePicture, picture.frame, ...delta);
    saveCurrentDraft();
  });
}

function enableInlineEdit(preview, element, field, slide, index) {
  const title = field === "title";
  const label = title ? "标题" : index === 0 ? "副标题" : `要点 ${field + 1}`;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", `编辑${label}`);
  element.tabIndex = 0;
  function start() {
    const input = document.createElement("textarea");
    input.className = "slide-editor-input";
    input.setAttribute("aria-label", `${label}编辑框`);
    input.maxLength = title ? limits.title : limits.point;
    input.value = element.textContent;
    const range = document.createRange();
    range.selectNodeContents(element);
    if (input.value) {
      input.style.paddingTop = `${Math.max(0, range.getBoundingClientRect().top - element.getBoundingClientRect().top)}px`;
    }
    element.removeAttribute("role");
    element.removeAttribute("aria-label");
    element.removeAttribute("tabindex");
    element.replaceChildren(input);
    input.focus({ preventScroll: true });
    input.select();
    let finished = false;
    function finish(save, refocus = false) {
      if (finished || !preview.isConnected || deck.slides[index] !== slide) return;
      finished = true;
      if (save) {
        const value = input.value.replace(/[\r\n\t]+/g, " ").trim();
        if (title) {
          slide.title = value;
          pages.children[index].title = value;
        } else {
          slide.points[field] = value;
        }
      }
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", `编辑${label}`);
      element.tabIndex = 0;
      const next = slideLayout(slide, index, deck.slides.length, slideStyle());
      next.elements.forEach((item, i) => paintSlideElement(preview.children[i], item));
      if (save) saveCurrentDraft();
      if (refocus) element.focus({ preventScroll: true });
    }
    input.addEventListener("blur", () => finish(true), { once: true });
    input.addEventListener("keydown", event => {
      if (event.isComposing || !["Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      finish(event.key === "Enter", true);
    });
  }
  element.addEventListener("click", event => {
    if (event.target === element) start();
  });
  element.addEventListener("keydown", event => {
    if (event.target !== element || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    start();
  });
}

function renderSlide() {
  const slide = deck.slides[selected];
  const layout = slideLayout(slide, selected, deck.slides.length, slideStyle());
  const preview = document.createElement("div");
  preview.className = "slide";
  preview.dataset.layout = layout.name;
  preview.style.backgroundColor = "#" + layout.background;
  preview.addEventListener("pointerdown", event => {
    if (!event.target.closest(".slide-picture")) selectPicture(undefined);
  });
  for (const item of layout.elements) {
    const element = document.createElement("div");
    element.className = item.kind === "text" ? "slide-text" : item.kind === "image" ? "slide-picture" : "slide-shape";
    paintSlideElement(element, item);
    if (item.field !== undefined) enableInlineEdit(preview, element, item.field, slide, selected);
    if (item.kind === "image") enablePictureEditing(preview, element, item.picture);
    preview.append(element);
  }
  stage.removeAttribute("data-empty");
  stage.replaceChildren(preview);
}

function updatePictureControls() {
  const slide = deck?.slides[selected];
  const loading = pendingPictures.has(slide);
  pictureControls.hidden = !slide;
  insertPicture.disabled = loading || busy;
  insertPicture.textContent = loading ? "读取图片中…" : "插入图片";
  const pictures = slide?.pictures ?? [];
  picturePicker.hidden = pictures.length < 2;
  picturePicker.replaceChildren(new Option("选择图片", ""), ...pictures.map((picture, index) =>
    new Option(`${index + 1}. ${picture.name}`, String(index))));
  picturePicker.value = selectedPicture ? String(pictures.indexOf(selectedPicture)) : "";
  pictureHint.hidden = !selectedPicture;
  download.disabled = !deck || exporting || deck.slides.some(item => pendingPictures.has(item));
  renderLibrary();
}

function finishCurrentTextEdit() {
  stage.querySelector(".slide-editor-input")?.blur();
}

function selectPage(index) {
  selected = index;
  selectedPicture = undefined;
  [...pages.children].forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  find("position").textContent = `第 ${index + 1} / ${deck.slides.length} 页`;
  pictureStatus.textContent = "";
  renderSlide();
  updatePictureControls();
}

function openDeck(newDeck, id) {
  deck = newDeck;
  activeDraft = id;
  pages.replaceChildren(...deck.slides.map((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = index === 0 ? "封面" : `第 ${index + 1} 页`;
    button.title = slide.title;
    button.addEventListener("click", () => selectPage(index));
    return button;
  }));
  pages.hidden = false;
  editHint.hidden = false;
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
theme.addEventListener("change", () => {
  finishCurrentTextEdit();
  updateSlideStyle();
  saveCurrentDraft();
});
color.addEventListener("input", () => {
  customColor = color.value.slice(1);
  updateSlideStyle();
  saveCurrentDraft();
});
resetColor.addEventListener("click", () => {
  customColor = "";
  updateSlideStyle();
  saveCurrentDraft();
});
library.addEventListener("keydown", event => {
  if (event.key === "Escape" && library.open) closeLibrary();
});
document.addEventListener("pointerdown", event => {
  if (library.open && !library.contains(event.target)) library.open = false;
});
newDraft.addEventListener("click", async () => {
  if (!activeDraft && (deck || notes.value.trim() || sources.length || audience.value || instructions.value) &&
      !await confirmReplace("新建空白将清除当前未保存的画布和资料。")) return;
  finishCurrentTextEdit();
  deck = undefined;
  activeDraft = undefined;
  selectedPicture = undefined;
  clearBrief();
  stage.dataset.empty = "true";
  stage.replaceChildren(emptyStage);
  pages.hidden = true;
  pages.replaceChildren();
  editHint.hidden = true;
  find("position").textContent = "";
  pictureStatus.textContent = "";
  updatePictureControls();
  setStatus("");
  closeLibrary();
});
saveExample.addEventListener("click", () => {
  finishCurrentTextEdit();
  activeDraft = crypto.randomUUID();
  saveCurrentDraft();
});
find("library-location").textContent = hosted ? "稿件保存在你的 Anna 账号内。" : "稿件保存在此浏览器中。";
void draftStorage.list().then(records => {
  for (const record of records) if (!drafts.has(record.id)) drafts.set(record.id, record);
}, () => {
  libraryReadFailed = true;
  showLibraryError("暂时无法读取历史。生成、编辑和下载仍可使用。");
}).finally(() => {
  loadingLibrary = false;
  renderLibrary();
});
insertPicture.addEventListener("click", () => pictureFile.click());
picturePicker.addEventListener("change", () => {
  const index = picturePicker.value;
  selectPicture(deck.slides[selected].pictures[index]);
  if (index !== "") stage.querySelectorAll(".slide-picture")[Number(index)]?.focus({ preventScroll: true });
});
pictureFile.addEventListener("change", async () => {
  const files = [...pictureFile.files];
  pictureFile.value = "";
  const current = deck;
  const index = selected;
  const slide = current?.slides[index];
  if (!files.length || !slide || pendingPictures.has(slide)) return;
  pendingPictures.add(slide);
  pictureStatus.textContent = "";
  updatePictureControls();
  try {
    const results = await Promise.allSettled(files.map(readSlidePicture));
    if (deck !== current) return;
    if (selected === index) finishCurrentTextEdit();
    const pictures = slide.pictures ??= [];
    const added = [];
    const errors = [];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const picture = { ...result.value, frame: placePicture(result.value, pictures.length) };
        pictures.push(picture);
        added.push(picture);
      } else {
        errors.push(`${files[i].name}：${result.reason.message}`);
      }
    });
    if (selected === index && added.length) {
      selectedPicture = added.at(-1);
      renderSlide();
    }
    if (added.length) saveCurrentDraft();
    if (errors.length) pictureStatus.textContent = `第 ${index + 1} 页：${errors.join(" ")}`;
  } finally {
    pendingPictures.delete(slide);
    updatePictureControls();
  }
});
find("pick-sources").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  for (const file of fileInput.files) void addSource(file);
  fileInput.value = "";
});
example.addEventListener("click", async () => {
  if (busy || openingDraft || replaceDialog.open || deck?.slides.some(slide => pendingPictures.has(slide))) return;
  if ((notes.value.trim() && notes.value !== sampleNotes || sources.length || deck) &&
      !await confirmReplace(activeDraft ? "载入示例会清除当前输入资料，已保存的 PPT 可以从「我的 PPT」打开。" : "载入示例会替换当前资料和幻灯片。")) return;
  finishCurrentTextEdit();
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
  if (busy || openingDraft || replaceDialog.open) return;
  if (deck?.slides.some(slide => pendingPictures.has(slide))) {
    setStatus("图片仍在读取，请稍后生成。", "error");
    return;
  }
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
  if (deck && !activeDraft && !await confirmReplace("生成会打开新稿。要保留当前示例，可先在「我的 PPT」中保存。")) return;
  finishCurrentTextEdit();
  const images = sources.filter(source => source.image).map(source => source.image);
  const documents = sources.filter(source => source.text).map(source => ({ name: source.file.name, text: source.text }));
  const style = { theme: theme.value, accent: themePalette(theme.value, customColor).accent };
  const draftStyle = slideStyle();
  const request = makeRequest({ notes: notes.value, audience: audience.value, pageCount: count, documents, images, instructions: instructions.value, style });
  busy = true;
  generate.disabled = true;
  example.disabled = true;
  updatePictureControls();
  setStatus("Anna 正在整理汇报，通常需要几秒到几十秒。");
  let usage = "";
  try {
    const anna = await getRuntime();
    const response = await anna.llm.complete(request);
    usage = formatUsage(response);
    const generated = parseDeck(response, count);
    theme.value = draftStyle.theme;
    customColor = draftStyle.accent;
    openDeck(generated, crypto.randomUUID());
    updateSlideStyle();
    saveCurrentDraft();
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
    updatePictureControls();
  }
});

download.addEventListener("click", async () => {
  if (!deck || download.disabled) return;
  finishCurrentTextEdit();
  exporting = true;
  updatePictureControls();
  try {
    if (!window.PptxGenJS) throw new Error("PPTX 组件未加载");
    const presentation = createPresentation(deck, window.PptxGenJS, slideStyle());
    await presentation.writeFile({ fileName: fileName(deck.slides[0].title) });
    setStatus("已生成 PPTX，文件中保留可编辑文字和形状。", "success");
  } catch {
    setStatus("导出失败，请再次点击下载。现有稿件已保留。", "error");
  } finally {
    exporting = false;
    updatePictureControls();
  }
});
