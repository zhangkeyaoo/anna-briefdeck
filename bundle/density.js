// Bounded content and a small set of native, content-sized fallbacks. No page splitting.
export const densityLimits = { pageCost: 600, deckCost: 6000, rawChars: 100000, minFont: 14 };
const area = { x: 0.65, y: 2.42, w: 12.03, h: 4.07 };
export const contentCost = points => points.reduce((sum, point) => sum + point.length + 12, 0);

export function wrapDensityText(value, width, size) {
  const capacity = Math.max(1, Math.floor(width * 72 / size) - 2);
  const tokens = value.match(/[+-]?\d+(?:[,.]\d+)*[%％]?|[A-Za-z]+|[\s\S]/gu) ?? [];
  const lines = []; let line = "";
  for (const token of tokens) {
    if (token === "\n") { lines.push(line); line = ""; continue; }
    for (const piece of Array.from(token).length > capacity ? Array.from(token) : [token]) {
      if (line && Array.from(line + piece).length > capacity && !/^[，。；：！？、）】]$/.test(piece)) { lines.push(line); line = ""; }
      line += piece;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines.join("\n");
}

function fitCell(point, field, box, font, main = false) {
  const inset = 0.65; // Every cell is a list member, including the emphasized first point.
  const w = box.w - inset - 0.16;
  const h = box.h - (main ? 0.24 : 0.14);
  const value = wrapDensityText(point, w, font);
  if (value.split("\n").length * font * 1.3 / 72 + 0.02 > h) return undefined;
  return { field, ...box, tx: box.x + inset, ty: box.y + (main ? 0.12 : 0.07), tw: w, th: h, size: font, value, main };
}

function listCells(points, fields, box, font) {
  const gap = 0.08;
  const height = (box.h - gap * (fields.length - 1)) / fields.length;
  return fields.map((field, index) => fitCell(points[field], field,
    { x: box.x, y: box.y + index * (height + gap), w: box.w, h: height }, font));
}

function plan(points, mode, primary) {
  for (const font of [20, 18, 16, 14]) {
    if (mode === "density-list") {
      const cells = listCells(points, points.map((_, i) => i), area, font);
      if (cells.every(Boolean)) return { id: mode, cells, font };
    } else if (mode === "density-grid") {
      for (const columns of [2, 3]) {
        if (columns > points.length) continue;
        const rows = Math.ceil(points.length / columns), gap = 0.14;
        const width = (area.w - 0.22 * (columns - 1)) / columns;
        const height = (area.h - gap * (rows - 1)) / rows;
        const cells = points.map((point, field) => fitCell(point, field, {
          x: area.x + field % columns * (width + 0.22), y: area.y + Math.floor(field / columns) * (height + gap), w: width, h: height
        }, font));
        if (cells.every(Boolean)) return { id: mode, cells, font };
      }
    } else {
      // A top focus block must not move a later list member ahead of earlier points.
      if (primary !== 0) return undefined;
      const main = fitCell(points[primary], primary, { ...area, h: 1.12 }, 22, true);
      const fields = points.map((_, i) => i).filter(field => field !== primary);
      const cells = fields.length ? listCells(points, fields, { ...area, y: area.y + 1.26, h: area.h - 1.26 }, font) : [];
      if (main && cells.every(Boolean)) return { id: mode, cells: [main, ...cells], font };
    }
  }
  return undefined;
}

export function densityPlans(slide) {
  if (!Array.isArray(slide.points) || !slide.points.length) return [];
  const primary = Number.isInteger(slide.lead) && slide.lead >= 0 && slide.lead < slide.points.length ? slide.lead : 0;
  const ordered = ["progress", "actions"].includes(slide.layout);
  const emphasize = ["risk", "decision"].includes(slide.layout) || Number.isInteger(slide.lead);
  const order = ordered ? ["density-list", "density-grid"] : emphasize ? ["density-focus", "density-grid", "density-list"] : ["density-grid", "density-list", "density-focus"];
  return order.map(id => plan(slide.points, id, primary)).filter(Boolean);
}

export function bodyReadable(elements) {
  for (const item of elements) {
    if (![item.x, item.y, item.w, item.h].every(Number.isFinite) || item.w <= 0 || item.h <= 0 ||
        item.x < 0 || item.y < 2.3 || item.x + item.w > 12.8 || item.y + item.h > 6.55) return false;
    if (Number.isInteger(item.field)) {
      if (item.w < 3.0 || item.size < densityLimits.minFont) return false;
      const lines = wrapDensityText(item.value, item.w, item.size).split("\n").length;
      if (lines * item.size * 1.3 / 72 > item.h + 0.02) return false;
    }
  }
  return true;
}

export function renderDensity(selected, slide, palette) {
  const rect = (x, y, w, h, color) => ({ kind: "rect", x, y, w, h, color });
  const text = (value, x, y, w, h, size, color, bold = false) => ({ kind: "text", value, x, y, w, h, size, color, bold });
  return selected.cells.flatMap(cell => {
    const { field, x, y, w, h, tx, ty, tw, th, size, value, main } = cell;
    const card = selected.id === "density-grid" || main;
    const label = String(field + 1).padStart(2, "0");
    return [
      ...(card ? [rect(x, y, w, h, main ? palette.forest : palette.paper), rect(x, y, 0.045, h, palette.accent)] :
        [rect(x + 0.65, y + h, w - 0.65, 0.008, palette.line)]),
      { ...text(label, x + 0.12, y + (h - 0.28) / 2, 0.43, 0.28, 12, main ? palette.mint : palette.muted, true), pointNumber: field },
      { ...text(value, tx, ty, tw, th, size, main ? palette.white : palette.ink, main), field }
    ];
  });
}
