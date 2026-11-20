import { defaultPages, limits, makeRequest, sampleAudience, sampleDeck, sampleNotes, validPageCount } from "./deck.js";
import { dimensions, layoutOptions, movePicture, pictureElement, placePicture, resizePicture, slideLayout, themePalette, withLayoutChoice } from "./layout.js";
import { renderingDiagnostics } from "./diagnostics.js";
import { createPresentation, fileName } from "./export.js";
import { readSlidePicture, readSource, sourceKind, sourceLimits } from "./sources.js";
import { annaLibrary, browserLibrary, restoreDraft, snapshotDraft } from "./library.js";
import { primaryEvidence } from "./slide-design.js";
import { invalidateMetricForEdit, metricIsStale } from "./metric.js";
import { pageSignature, restoreVisual, visualSnapshot } from "./redesign.js";
import { creditSummary, formatCredits, redesignFailure, runRedesignOperation } from "./redesign-operation.js";
import { runGenerationOperation } from "./generation-operation.js";

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
const generationDiagnostic = find("generation-diagnostic");
let failedGeneration;
const library = find("library");
const draftList = find("draft-list");
const newDraft = find("new-draft");
const saveDraftButton = find("save-draft");
const draftSaveState = find("draft-save-state");
const deleteDialog = find("delete-dialog");
const libraryStatus = find("library-status");
const layoutControls = find("layout-controls");
const layoutChoices = find("layout-options");
const layoutUndo = find("layout-undo");
const layoutReset = find("layout-reset");
const layoutStatus = find("layout-status");
const previousLayouts = new WeakMap();
const redesignDialog = find("redesign-dialog");
let redesignPending = false;
let redesignContext;
let lastRedesignAttempt;
const emptyStage = stage.firstElementChild;
const params = new URLSearchParams(location.search);
const hosted = window.parent !== window && params.has("wid") && params.has("t");
const developerMode = params.get("debug") === "1";
let runtimePromise;
let deck;
let selected = 0;
let selectedPicture;
let busy = false;
let generationContext;
let lastGenerationOperation;
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
let deletingDraft;
let openingDraft = false;
let loadingLibrary = true;
let libraryReadFailed = false;
// Developer inspection remains available without a visible production control.
window.briefdeckDiagnostics=()=>structuredClone({...deck?currentRenderingReport():{},generationFailure:failedGeneration,generationOperation:lastGenerationOperation});

function slideStyle() {
  return { theme: theme.value, accent: customColor };
}

function updateSlideStyle() {
  color.value = "#" + themePalette(theme.value, customColor).accent.toLowerCase();
  resetColor.hidden = !customColor;
  if (deck) renderSlide();
}

function updateLibraryActions() {
  const disabled = busy || exporting || openingDraft || Boolean(deletingDraft) || loadingLibrary ||
    Boolean(deck?.slides.some(slide => pendingPictures.has(slide)));
  const saving = pendingSaves.has(activeDraft);
  newDraft.disabled = disabled;
  saveDraftButton.disabled = disabled || !deck || saving;
  draftSaveState.hidden = !deck;
  draftSaveState.textContent = saving ? "正在保存…" : failedDrafts.has(activeDraft) ? "保存失败，可重试" :
    activeDraft ? "当前 PPT 已保存" : "当前 PPT 尚未保存";
  return disabled;
}

function renderLibrary() {
  const disabled = updateLibraryActions();
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
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button draft-delete";
    remove.disabled = disabled;
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除 ${title.textContent}`);
    remove.addEventListener("click", () => deleteDraft(record));
    row.append(button, remove);
    return row;
  }));
}

function showLibraryError(message) {
  libraryStatus.textContent = message;
  libraryStatus.hidden = !message;
}

function saveCurrentDraft() {
  if (!activeDraft || !deck || activeDraft === deletingDraft) return;
  const record = snapshotDraft(activeDraft, deck, slideStyle());
  drafts.set(record.id, record);
  const queued = (pendingSaves.get(record.id) ?? Promise.resolve()).catch(() => {}).then(() => {
    if (drafts.get(record.id) === record) return draftStorage.save(record);
  });
  pendingSaves.set(record.id, queued);
  renderLibrary();
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
    updateLibraryActions();
  });
}

async function deleteDraft(record) {
  const current = record.id === activeDraft;
  find("delete-message").textContent = `删除「${record.title || "未命名 PPT"}」？此操作无法撤销。${current ? "当前画布也会关闭。" : ""}`;
  deleteDialog.returnValue = "cancel";
  const confirmed = new Promise(resolve => {
    deleteDialog.addEventListener("close", () => resolve(deleteDialog.returnValue === "delete"), { once: true });
  });
  deleteDialog.showModal();
  if (!await confirmed) return;
  if (!finishCurrentTextEdit()) return;
  deletingDraft = record.id;
  renderLibrary();
  try {
    await pendingSaves.get(record.id)?.catch(() => {});
    await draftStorage.remove(record.id);
    drafts.delete(record.id);
    failedDrafts.delete(record.id);
    if (!libraryReadFailed && !failedDrafts.size) showLibraryError("");
    if (current) {
      clearCanvas();
      setStatus("");
    }
  } catch {
    showLibraryError("未能删除这份 PPT。稿件仍保留，可以稍后重试。");
  } finally {
    deletingDraft = undefined;
    renderLibrary();
    newDraft.focus();
  }
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

function clearCanvas() {
  deck = undefined;
  activeDraft = undefined;
  selectedPicture = undefined;
  stage.dataset.empty = "true";
  stage.replaceChildren(emptyStage);
  pages.hidden = true;
  pages.replaceChildren();
  editHint.hidden = true;
  find("position").textContent = "";
  pictureStatus.textContent = "";
  layoutControls.hidden = true;
  layoutControls.open = false;
  find("metric-status").hidden = true;
  find("density-status").hidden = true;
  updatePictureControls();
}

async function openDraft(id) {
  if (id === activeDraft) {
    closeLibrary();
    return;
  }
  if (!finishCurrentTextEdit()) return;
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

function showGenerationDiagnostic(response, error, pageCount) {
  failedGeneration = {
    error: error.message, requestedPages: pageCount, recordedAt: new Date().toISOString(),
    operation:structuredClone(lastGenerationOperation),
    response: {
      content: response.content, model: response.model, stopReason: response.stopReason, usage: response.usage,
      _meta: {
        quotaConsumed: response._meta?.quotaConsumed,
        maxTokens: response._meta?.maxTokens, thinking: response._meta?.thinking
      }
    }
  };
  find("diagnostic-error").textContent = error.message;
  find("diagnostic-output").textContent = JSON.stringify(failedGeneration, null, 2);
  generationDiagnostic.hidden = !developerMode;
  generationDiagnostic.open = false;
}

find("download-diagnostic").addEventListener("click", () => {
  if (!failedGeneration) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(failedGeneration, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "briefdeck-generation-diagnostic.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

find("download-rendering-diagnostic").addEventListener("click", () => {
  if (!deck || !finishCurrentTextEdit()) return;
  const report = { ...currentRenderingReport(), originalModelText: deck.generationTrace?.rawText ?? null };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "briefdeck-layout-diagnostic.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

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
  find("multi-file-hint").hidden=sources.length<3;
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
    if (source.warning) {
      const warning = document.createElement("p");
      warning.textContent = source.warning;
      row.append(warning);
    }
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
    if (!kind) throw new Error("支持 DOCX、TXT、PDF、PNG 和 JPEG。");
    if (count >= sourceLimits.perKind) throw new Error(group === "image" ? "最多添加 2 张图片。" : "最多添加 2 份文档。");
    renderSources();
    Object.assign(source, await readSource(file, kind), { state: "ready" });
    if (source.warning && sources.includes(source)) sourceDetails.open = true;
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
  if (item.metricPart) element.dataset.metricPart = item.metricPart;
  else delete element.dataset.metricPart;
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
  if (!finishCurrentTextEdit()) return;
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
    if (!finishCurrentTextEdit()) return;
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
    input.value = title ? slide.title : slide.points[field];
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
      if (finished || !preview.isConnected || deck.slides[index] !== slide) return true;
      let metricInvalidated = false;
      if (save) {
        const value = input.value.replace(/[\r\n\t]+/g, " ").trim();
        const candidate = { ...slide, points: [...slide.points] };
        if (title) candidate.title = value;
        else candidate.points[field] = value;
        try {
          slideLayout(candidate, index, deck.slides.length, slideStyle());
        } catch (error) {
          const notice = find("density-status");
          notice.hidden = false;
          notice.dataset.kind = "error";
          notice.textContent = `${error.message} 本次编辑未保存，文字仍保留在编辑框；可缩短内容或按 Esc 取消。`;
          return false;
        }
        if (title) {
          slide.title = value;
          pages.children[index].title = value;
        } else {
          metricInvalidated = invalidateMetricForEdit(slide, field, value);
          if (metricInvalidated) previousLayouts.delete(slide);
          slide.points[field] = value;
        }
      }
      finished = true;
      find("density-status").hidden = true;
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", `编辑${label}`);
      element.tabIndex = 0;
      const next = slideLayout(slide, index, deck.slides.length, slideStyle());
      const changedStructure = next.elements.some((item, i) => {
        const node = preview.children[i];
        const kind = item.kind === "text" ? "slide-text" : item.kind === "image" ? "slide-picture" : "slide-shape";
        return !node?.classList.contains(kind) || (node.dataset.field ?? "") !== String(item.field ?? "");
      });
      if (metricInvalidated || next.elements.length !== preview.children.length || changedStructure) renderSlide();
      else next.elements.forEach((item, i) => paintSlideElement(preview.children[i], item));
      if (save) saveCurrentDraft();
      updateLayoutControls();
      if (refocus) stage.querySelector(`[data-field="${field}"]`)?.focus({ preventScroll: true });
      return true;
    }
    input.commitEdit = () => finish(true);
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", event => {
      if (event.isComposing || !["Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      finish(event.key === "Enter", true);
    });
  }
  element.addEventListener("click", event => {
    if (event.target === element) start();
  });
  element.addEventListener("pointerdown", event => {
    if (event.target !== element || !preview.querySelector(".slide-editor-input")) return;
    event.preventDefault();
    if (!finishCurrentTextEdit()) return;
    stage.querySelector(`[data-field="${field}"]`)?.click();
  });
  element.addEventListener("keydown", event => {
    if (event.target !== element || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    start();
  });
}

function renderSlide() {
  const slide = deck.slides[selected];
  const lead = primaryEvidence(slide);
  if (lead !== undefined && !Object.hasOwn(slide, "lead")) slide.lead = lead;
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
    if (item.field !== undefined) {
      element.dataset.field = String(item.field);
      enableInlineEdit(preview, element, item.field, slide, selected);
    }
    if (item.kind === "image") enablePictureEditing(preview, element, item.picture);
    preview.append(element);
  }
  stage.removeAttribute("data-empty");
  stage.replaceChildren(preview);
  const metricNotice = find("metric-status");
  metricNotice.hidden = !metricIsStale(slide);
  metricNotice.textContent = metricNotice.hidden ? "" : "指标来源已修改，已停用数据图并保留当前文案。请核对标题及相关文案。";
  updateLayoutControls();
}

function layoutSnapshot(slide) {
  return { present: Object.hasOwn(slide, "manualLayout"), value: slide.manualLayout,
    visual:visualSnapshot(slide), original:structuredClone(slide.redesignOriginal), trace:structuredClone(slide.redesignTrace) };
}

function restoreLayoutSnapshot(slide, snapshot) {
  if(snapshot.visual) {
    restoreVisual(slide,snapshot.visual);
    for(const [key,value]of [["redesignOriginal",snapshot.original],["redesignTrace",snapshot.trace]]) {
      if(value===undefined)delete slide[key];else slide[key]=structuredClone(value);
    }
    return;
  }
  if (snapshot.present) slide.manualLayout = snapshot.value;
  else delete slide.manualLayout;
}

function updateLayoutControls() {
  find("rendering-diagnostic").hidden = !deck || !developerMode;
  if (deck) find("rendering-output").textContent = JSON.stringify(currentRenderingReport(), null, 2);
  const slide = deck?.slides[selected];
  const options = slide ? layoutOptions(slide, selected) : [];
  layoutControls.hidden = options.length < 2 && !previousLayouts.has(slide) && !slide?.redesignOriginal;
  const disabled = busy || exporting || openingDraft || Boolean(deletingDraft) || pendingPictures.has(slide);
  find("redesign-controls").hidden = !slide;
  find("redesign").disabled = disabled || redesignPending || redesignDialog.open || !hosted || selected===0;
  find("redesign-hint").textContent = selected===0 ? "封面为固定排版，暂不支持AI重新设计；请选择正文页。" :
    !hosted ? "请在 Anna 中使用AI单页设计；本地预览可使用免费的更换布局。" :
    "消耗积分 · 最多4次 · 先预览";
  find("layout-page").textContent = slide ? `第 ${selected + 1} 页` : "";
  const current = options.find(option => option.id === slide?.manualLayout);
  find("layout-current").textContent = `当前：${current?.label ?? "原有布局"}`;
  layoutChoices.replaceChildren(...options.map(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layout-choice";
    button.dataset.choice = option.id;
    button.disabled = disabled;
    button.setAttribute("aria-label", option.label);
    button.setAttribute("aria-pressed", String(option.id === current?.id));
    const label = document.createElement("strong");
    label.textContent = option.label;
    const description = document.createElement("span");
    const hints={"ai-design":"本页已确认方案","metric-focus":"突出关键指标","metric-relation":"展示数值关系","metric-cards":"各项并列呈现",
      "summary-focus":"突出第一条","summary-cards":"各项并列呈现","plain":"按顺序完整呈现","density-list":"按顺序完整呈现",
      "density-grid":"分栏呈现要点","density-focus":"突出第01条","relation-roles":"角色与职责对照","relation-sequence":"按步骤顺序展开",
      "narrative":"保留原有叙事"};
    description.textContent = hints[option.id]??option.description;
    button.append(label, description);
    // Commit an active canvas editor inside the click transaction before rebuilding options.
    button.addEventListener("pointerdown", event => event.preventDefault());
    button.addEventListener("click", () => changeLayout("choose", option.id));
    return button;
  }));
  layoutUndo.disabled = disabled || !slide || !previousLayouts.has(slide);
  layoutReset.disabled = disabled || !slide || !Object.hasOwn(slide, "manualLayout") && !slide.redesignOriginal;
}

function changeLayout(action, choice) {
  const slide = deck?.slides[selected];
  if (!slide || busy || exporting || openingDraft || deletingDraft || pendingPictures.has(slide)) return;
  if (!finishCurrentTextEdit()) return;
  const before = layoutSnapshot(slide);
  const previous = previousLayouts.get(slide);
  try {
    if (action === "choose") {
      if (slide.manualLayout === choice) return;
      const candidate = withLayoutChoice(slide, selected, deck.slides.length, choice, slideStyle());
      slide.manualLayout = candidate.manualLayout;
    } else if (action === "undo") {
      if (!previous) return;
      restoreLayoutSnapshot(slide, previous);
    } else {
      if(slide.redesignOriginal) {
        restoreVisual(slide,slide.redesignOriginal);
        delete slide.redesignOriginal;
        delete slide.redesignTrace;
      } else delete slide.manualLayout;
    }
    renderSlide();
    find("redesign-status").hidden=true;
    if (action === "undo") previousLayouts.delete(slide);
    else previousLayouts.set(slide, before);
    layoutStatus.textContent = action === "undo" ? "已撤销上次布局切换。" : action === "reset" ? "已恢复本页原有布局。" : "已更换本页布局。";
    layoutStatus.dataset.kind = "success";
    layoutStatus.hidden = false;
    updateLayoutControls();
    if (action === "choose") layoutChoices.querySelector(`[data-choice="${choice}"]`)?.focus({ preventScroll: true });
    saveCurrentDraft();
  } catch (error) {
    restoreLayoutSnapshot(slide, before);
    renderSlide();
    layoutStatus.textContent = error.message || "未能切换布局，已保留原布局。";
    layoutStatus.dataset.kind = "error";
    layoutStatus.hidden = false;
  }
}

layoutUndo.addEventListener("click", () => changeLayout("undo"));
layoutReset.addEventListener("click", () => changeLayout("reset"));

function redesignMatches(context) {
  return deck===context.deck && selected===context.index && deck.slides[selected]===context.slide &&
    pageSignature(context.slide,slideStyle())===context.signature;
}

function currentRenderingReport() {
  return { latestSinglePageAttempt:lastRedesignAttempt?.deck===deck?lastRedesignAttempt.data:undefined,
    ...renderingDiagnostics(deck,slideStyle()) };
}

function recordRedesignAttempt(context,status,extra={}) {
  context.attempt??={page:context.index+1,recordedAt:new Date().toISOString(),requestSent:false};
  Object.assign(context.attempt,{status},extra);
  lastRedesignAttempt={deck:context.deck,data:context.attempt};
}

function redesignMessage(message,kind="info") {
  const element=find("redesign-status");
  element.textContent=message; element.dataset.kind=kind; element.hidden=false;
}

function cancelRedesign() {
  const context=redesignContext;
  if(context) {
    context.cancelled=true;
    if(!["failed","expired"].includes(context.operation?.status)) {
      if(context.operation) {
        context.operation.status="cancelled";
        const pending=context.operation.attempts?.at(-1);
        if(pending && pending.status!=="failed")pending.status="cancelled";
      }
      redesignMessage(`已取消第 ${context.index+1} 页设计，原稿未更改。${context.usage??"未发起设计调用。"}`);
    }
  }
  redesignContext=undefined;
  if(redesignDialog.open)redesignDialog.close();
  updateLayoutControls();
}

find("redesign").addEventListener("pointerdown",event=>event.preventDefault());
find("redesign").addEventListener("click",()=>{
  if(!deck || selected===0 || !hosted || busy || exporting || redesignPending || redesignDialog.open || !finishCurrentTextEdit())return;
  const slide=deck.slides[selected];
  if(pendingPictures.has(slide))return;
  redesignContext={deck,slide,index:selected,style:slideStyle(),signature:pageSignature(slide,slideStyle()),cancelled:false};
  find("redesign-title").textContent=`AI 重新设计第 ${selected+1} 页`;
  find("redesign-confirm").hidden=false;
  find("redesign-request").hidden=false;
  find("redesign-request").disabled=false;
  find("redesign-apply").hidden=true;
  find("redesign-apply").disabled=false;
  find("redesign-cancel").textContent="取消";
  find("redesign-preview").hidden=true;
  find("redesign-preview").replaceChildren();
  find("redesign-intent").hidden=true;
  find("redesign-progress").textContent="只发送当前页内容与设计约束；取消后不会修改原稿。";
  find("redesign-progress").dataset.kind="info";
  find("redesign-detail").hidden=true;
  find("redesign-detail").open=false;
  redesignDialog.showModal();
  updateLayoutControls();
});
find("redesign-cancel").addEventListener("click",cancelRedesign);
redesignDialog.addEventListener("cancel",event=>{event.preventDefault();cancelRedesign();});
redesignDialog.addEventListener("close",()=>{if(redesignContext)cancelRedesign();});

function showRedesignPreview(candidate,context) {
  const layout=slideLayout(candidate,context.index,context.deck.slides.length,context.style);
  const preview=document.createElement("div");
  preview.className="slide"; preview.style.backgroundColor="#"+layout.background;
  for(const original of layout.elements) {
    let item=original;
    if(item.kind==="image") {
      const copy=document.createElement("canvas");
      copy.width=item.picture.preview.width;copy.height=item.picture.preview.height;
      copy.getContext("2d").drawImage(item.picture.preview,0,0);
      item={...item,picture:{...item.picture,preview:copy}};
    }
    const element=document.createElement("div");
    element.className=item.kind==="text"?"slide-text":item.kind==="image"?"slide-picture":"slide-shape";
    paintSlideElement(element,item);
    preview.append(element);
  }
  find("redesign-preview").replaceChildren(preview);
  find("redesign-preview").hidden=false;
}

find("redesign-request").addEventListener("click",async()=>{
  const context=redesignContext;
  if(!context || context.started || context.cancelled || redesignPending || !redesignMatches(context))return;
  context.started=true;
  context.operation={id:crypto.randomUUID(),page:context.index+1,status:"requesting",requestSent:false,attempts:[],credits:{total:"0",unknown:0}};
  context.attempt=context.operation;
  lastRedesignAttempt={deck:context.deck,data:context.operation};
  redesignPending=true;
  find("redesign-request").disabled=true;
  find("redesign-progress").textContent="正在优化页面设计，请稍候……";
  try {
    const anna=await getRuntime();
    if(context.cancelled)return;
    const result=await runRedesignOperation({slide:context.slide,index:context.index,total:context.deck.slides.length,style:context.style,
      complete:request=>anna.llm.complete(request),isCancelled:()=>context.cancelled,isCurrent:()=>redesignMatches(context),operation:context.operation,
      onUpdate:operation=>{
        lastRedesignAttempt={deck:context.deck,data:operation};
        context.usage=formatCredits(operation.credits);
        updateLayoutControls();
      }});
    context.usage=formatCredits(result.operation.credits);
    find("redesign-usage").textContent=context.usage;
    find("redesign-detail").hidden=!developerMode;
    if(context.cancelled || redesignContext!==context)return;
    find("redesign-request").hidden=true;
    if(result.operation.status!=="candidate") {
      find("redesign-cancel").textContent="关闭";
      find("redesign-progress").dataset.kind="error";
      find("redesign-progress").textContent=redesignFailure+context.usage;
      redesignMessage(redesignFailure+context.usage,"error");
      return;
    }
    context.candidate=result.candidate;
    context.response=result.response;
    showRedesignPreview(context.candidate,context);
    find("redesign-progress").textContent="候选已生成，尚未应用。"+context.usage;
    find("redesign-intent").textContent=result.intent;
    find("redesign-intent").hidden=!developerMode||!result.intent;
    find("redesign-confirm").hidden=true;
    find("redesign-apply").hidden=false;
  } catch(error) {
    context.operation.status=context.cancelled?"cancelled":"failed";
    context.operation.reason=error.message;
    context.usage??=formatCredits(creditSummary(context.operation.attempts));
    lastRedesignAttempt={deck:context.deck,data:context.operation};
    if(context.cancelled || redesignContext!==context)return;
    find("redesign-request").hidden=true;
    find("redesign-progress").dataset.kind="error";
    find("redesign-cancel").textContent="关闭";
    find("redesign-progress").textContent=redesignFailure+(context.usage??"本次积分用量待平台确认。");
    redesignMessage(find("redesign-progress").textContent,"error");
  } finally {
    redesignPending=false;
    if(context.cancelled && deck===context.deck)redesignMessage(`第 ${context.index+1} 页设计已取消，原稿未更改。${context.usage??"未发起设计调用。"}`);
    updateLayoutControls();
  }
});

find("redesign-apply").addEventListener("click",()=>{
  const context=redesignContext;
  if(!context?.candidate || context.cancelled || redesignPending)return;
  if(!redesignMatches(context)) {
    find("redesign-progress").dataset.kind="error";
    context.operation.status="expired";
    find("redesign-progress").textContent="页面已变化，候选已失效，原稿未更改。"+(context.usage??"");
    find("redesign-apply").disabled=true;
    return;
  }
  const before=layoutSnapshot(context.slide);
  try {
    const original=context.slide.redesignOriginal??visualSnapshot(context.slide);
    restoreVisual(context.slide,visualSnapshot(context.candidate));
    context.slide.redesignOriginal=structuredClone(original);
    context.slide.redesignTrace={rawText:context.response.content.text,model:context.response.model,usage:context.response.usage,
      quotaConsumed:context.operation.credits.total,attempts:structuredClone(context.operation.attempts),credits:context.operation.credits,operationId:context.operation.id,recordedAt:new Date().toISOString(),customGrid:context.slide.manualLayout==="ai-design"};
    recordRedesignAttempt(context,"applied");
    renderSlide();
    previousLayouts.set(context.slide,before);
    context.applied=true;
    redesignContext=undefined;
    redesignDialog.close();
    layoutStatus.hidden=true;
    redesignMessage(`第 ${context.index+1} 页设计已应用，可撤销。${context.usage??""}`,"success");
    saveCurrentDraft();
    updateLayoutControls();
  } catch(error) {
    recordRedesignAttempt(context,"failed",{error:error.message});
    restoreLayoutSnapshot(context.slide,before);
    renderSlide();
    find("redesign-progress").dataset.kind="error";
    find("redesign-progress").textContent=redesignFailure+(context.usage??"");
  }
});

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
  updateLayoutControls();
}

function finishCurrentTextEdit() {
  return stage.querySelector(".slide-editor-input")?.commitEdit() ?? true;
}

function selectPage(index) {
  if (!finishCurrentTextEdit()) return;
  selected = index;
  selectedPicture = undefined;
  [...pages.children].forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  find("position").textContent = `第 ${index + 1} / ${deck.slides.length} 页`;
  pictureStatus.textContent = "";
  layoutControls.open = false;
  layoutStatus.hidden = true;
  renderSlide();
  updatePictureControls();
}

function openDeck(newDeck, id) {
  find("redesign-status").hidden=true;
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
  if (!finishCurrentTextEdit()) return;
  updateSlideStyle();
  saveCurrentDraft();
});
color.addEventListener("input", () => {
  if (!finishCurrentTextEdit()) return;
  customColor = color.value.slice(1);
  updateSlideStyle();
  saveCurrentDraft();
});
resetColor.addEventListener("click", () => {
  if (!finishCurrentTextEdit()) return;
  customColor = "";
  updateSlideStyle();
  saveCurrentDraft();
});
library.addEventListener("keydown", event => {
  if (event.key === "Escape" && library.open) closeLibrary();
});
document.addEventListener("pointerdown", event => {
  if (library.open && !deleteDialog.open && !library.contains(event.target)) library.open = false;
});
newDraft.addEventListener("click", async () => {
  if (!activeDraft && (deck || notes.value.trim() || sources.length || audience.value || instructions.value) &&
      !await confirmReplace("新建空白将清除当前未保存的画布和资料。")) return;
  if (!finishCurrentTextEdit()) return;
  clearBrief();
  clearCanvas();
  setStatus("");
  closeLibrary();
});
saveDraftButton.addEventListener("click", () => {
  if (!finishCurrentTextEdit()) return;
  activeDraft ??= crypto.randomUUID();
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
    if (selected === index && !finishCurrentTextEdit()) return;
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
  if (busy || openingDraft || deletingDraft || deleteDialog.open || replaceDialog.open || deck?.slides.some(slide => pendingPictures.has(slide))) return;
  if ((notes.value.trim() && notes.value !== sampleNotes || sources.length || deck) &&
      !await confirmReplace(activeDraft ? "载入示例会清除当前输入资料，已保存的 PPT 可以从「我的 PPT」打开。" : "载入示例会替换当前资料和幻灯片。")) return;
  if (!finishCurrentTextEdit()) return;
  audience.value = sampleAudience;
  notes.value = sampleNotes;
  pageCount.value = defaultPages;
  checkPageCount();
  sources = [];
  renderSources();
  openDeck(structuredClone(sampleDeck));
  setStatus("已载入示例。你可以直接修改和下载。");
});

find("cancel-generation").addEventListener("click",()=>{
  if(!generationContext)return;
  generationContext.cancelled=true;
  find("cancel-generation").disabled=true;
  setStatus("已取消生成，原稿未更改。已发出请求的积分将在平台返回后汇总。");
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || openingDraft || deletingDraft || deleteDialog.open || replaceDialog.open) return;
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
  if (deck && !activeDraft && !await confirmReplace("生成会打开新稿。要保留当前 PPT，可先在「我的 PPT」中保存。")) return;
  if (!finishCurrentTextEdit()) return;
  const images = sources.filter(source => source.image).map(source => source.image);
  const documents = sources.filter(source => source.text).map(source => ({ name: source.file.name, text: source.text }));
  const style = { theme: theme.value, accent: themePalette(theme.value, customColor).accent };
  const draftStyle = slideStyle();
  const request = makeRequest({ notes: notes.value, audience: audience.value, pageCount: count, documents, images, instructions: instructions.value, style });
  busy = true;
  const context={cancelled:false,operation:{}};
  generationContext=context;
  find("cancel-generation").hidden=false;
  find("cancel-generation").disabled=false;
  generate.disabled = true;
  example.disabled = true;
  updatePictureControls();
  setStatus("Anna 正在整理汇报，通常需要几秒到几十秒。");
  failedGeneration = undefined;
  generationDiagnostic.hidden = true;
  let usage = "";
  let response;
  try {
    const anna = await getRuntime();
    const result=await runGenerationOperation({request,pages:count,complete:request=>anna.llm.complete(request),operation:context.operation,
      isCancelled:()=>context.cancelled,isCurrent:()=>generationContext===context,
      onUpdate:operation=>{lastGenerationOperation=structuredClone(operation);}});
    response=result.response;
    usage=formatCredits(result.operation.credits);
    if(["cancelled","expired"].includes(result.operation.status)){
      setStatus(`已取消生成，原稿未更改。${usage}`);return;
    }
    if(!result.deck)throw result.error??new Error("生成失败");
    const generated = result.deck;
    generated.generationTrace = { rawText: response.content.text, model: response.model, usage: response.usage, quotaConsumed: result.operation.credits.total,
      credits:result.operation.credits,attempts:result.operation.attempts,recordedAt: new Date().toISOString() };
    theme.value = draftStyle.theme;
    customColor = draftStyle.accent;
    openDeck(generated, crypto.randomUUID());
    updateSlideStyle();
    saveCurrentDraft();
    const review = images.length ? "请核对从图片读取的数字。" : "";
    setStatus(`已生成 ${count} 页。${usage}${review}`, "success");
  } catch (error) {
    usage ||= formatCredits(creditSummary(context.operation.attempts??[]));
    if(context.cancelled){setStatus(`已取消生成，原稿未更改。${usage}`);return;}
    if (response && error instanceof Error) showGenerationDiagnostic(response, error, count);
    const code = [error?.data?.errorCode, error?.data?.code, error?.code, error?.message].join(" ");
    if (/APP_MODEL_NOT_VISION_CAPABLE/i.test(code)) {
      setStatus("Anna 当前无法读取图片，请移除图片后再试。"+usage, "error");
    } else if (/quota|429|credit|insufficient/i.test(code)) {
      setStatus("Anna 积分不足，请检查余额后再试。已有稿件仍可编辑和下载。"+usage, "error");
    } else {
      const detail = response?.stopReason==="maxTokens" ? "Anna 返回内容被截断，原稿未更改。" : error instanceof Error && /^Anna |^第 /.test(error.message) ? error.message : "无法连接 Anna 或生成暂时失败，可以稍后手动重试。";
      setStatus(detail + usage, "error");
    }
  } finally {
    if(generationContext===context)generationContext=undefined;
    find("cancel-generation").hidden=true;
    busy = false;
    generate.disabled = false;
    example.disabled = false;
    updatePictureControls();
  }
});

download.addEventListener("click", async () => {
  if (!deck || download.disabled) return;
  if (!finishCurrentTextEdit()) return;
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
