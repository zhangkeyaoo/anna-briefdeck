import { limits } from "./deck.js";

export const sourceLimits = { perKind: 2, bytes: 5 * 1024 * 1024 };
const maxXmlBytes = 2 * 1024 * 1024;
const pictureTypes = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function sourceKind(name) {
  const extension = name.split(".").at(-1).toLowerCase();
  if (!name.includes(".")) return undefined;
  if (extension === "docx" || extension === "txt" || extension === "pdf") return extension;
  if (Object.hasOwn(pictureTypes, extension)) return "image";
}

export async function readSource(file, kind, previewEdge = 80) {
  if (!file.size) throw new Error("文件为空。");
  if (file.size > sourceLimits.bytes) throw new Error("单个文件不能超过 5 MB。");
  if (kind === "image") return readPicture(file, previewEdge);
  if (kind === "pdf") {
    const { readPdf } = await import("./pdf-source.js");
    return readPdf(file, limits.text);
  }
  let text;
  try {
    text = kind === "docx" ? await readWord(file) : new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch (error) {
    if (error?.message === "Word 正文过大，请缩减后再添加。") throw error;
    throw new Error(kind === "docx" ? "无法读取 Word 正文。请检查文件是否损坏或已加密。" : "无法读取 TXT，请保存为 UTF-8。");
  }
  if (!text.trim()) throw new Error("未找到可用文字。");
  return { text: text.trim() };
}

export async function readSlidePicture(file) {
  if (sourceKind(file.name) !== "image") throw new Error("插图支持 PNG 和 JPEG。");
  const { preview, image, width, height } = await readSource(file, "image", 960);
  return {
    name: file.name, preview, width, height,
    data: preview.toDataURL(image.mimeType, 0.9)
  };
}

async function readWord(file) {
  const zip = await globalThis.JSZip.loadAsync(await file.arrayBuffer());
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("Missing DOCX document");
  const xml = await new Promise((resolve, reject) => {
    const stream = entry.internalStream("uint8array");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    stream.on("data", chunk => {
      size += chunk.length;
      try {
        if (size > maxXmlBytes) throw new Error("Word 正文过大，请缩减后再添加。");
        text += decoder.decode(chunk, { stream: true });
      } catch (error) {
        stream.pause();
        reject(error);
      }
    }).on("error", reject).on("end", () => {
      try {
        resolve(text + decoder.decode());
      } catch (error) {
        reject(error);
      }
    }).resume();
  });
  if (/<!DOCTYPE/i.test(xml)) throw new Error("Unexpected DOCX document type");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const body = document.getElementsByTagNameNS(wordNamespace, "body")[0];
  if (!body || document.querySelector("parsererror")) throw new Error("Invalid DOCX document");
  return Array.from(body.getElementsByTagNameNS(wordNamespace, "p"), paragraph =>
    Array.from(paragraph.getElementsByTagNameNS(wordNamespace, "*"), node => {
      if (node.localName === "t") return node.textContent;
      if (node.localName === "tab" || node.localName === "br") return " ";
      return "";
    }).join("").trim()
  ).filter(Boolean).join("\n");
}

async function readPicture(file, previewEdge) {
  const mimeType = pictureTypes[file.name.split(".").at(-1).toLowerCase()];
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const magic = mimeType === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
  if (!magic.every((byte, i) => signature[i] === byte)) throw new Error("图片内容与格式不符或文件已损坏。");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("无法解码图片，请重新导出为 PNG 或 JPEG。");
  }
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const preserveOriginal = longEdge <= 1800 && file.size <= 768 * 1024;
    const draw = (maxEdge, flatten) => {
      const scale = Math.min(1, maxEdge / longEdge);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: !flatten });
      if (flatten) {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas;
    };
    const preview = draw(previewEdge, previewEdge === 80 || !preserveOriginal);
    const width = bitmap.width;
    const height = bitmap.height;
    if (preserveOriginal) {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      return { preview, width, height, image: { type: "image", mimeType, data } };
    }
    const data = draw(1800, true).toDataURL("image/jpeg", 0.86).split(",")[1];
    return { preview, width, height, image: { type: "image", mimeType: "image/jpeg", data } };
  } finally {
    bitmap.close();
  }
}
