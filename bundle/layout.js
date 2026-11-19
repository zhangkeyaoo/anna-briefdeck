import { designGrid, primaryEvidence } from "./slide-design.js";

export const dimensions = { width: 13.333333, height: 7.5 };
export const fontFace = "Microsoft YaHei";

const minimal = {
  forest: "16362E", mint: "B9E5AC", paper: "F6F8F2",
  white: "FFFFFF", muted: "35554C", ink: "182D28", pale: "E4EFE5", line: "D4E2D6",
  sage: "E9F1E6", amber: "F6E9D9", umber: "714827",
  background: "FFFFFF", heading: "16362E", accent: "3E795B"
};
const technology = {
  forest: "142B45", mint: "6EE7F9", paper: "14233B",
  white: "F4F8FF", muted: "8DE4F2", ink: "E8F1FF", pale: "172B43", line: "30475F",
  sage: "172F49", amber: "352C2C", umber: "FFD3A1",
  background: "0B1527", heading: "F2F7FF", accent: "48D7EF"
};

export function themePalette(theme, accent) {
  const dark = theme === "technology";
  const base = dark ? technology : minimal;
  if (!/^[0-9a-fA-F]{6}$/.test(accent ?? "")) return base;
  const color = accent.toUpperCase();
  return {
    ...base, accent: color,
    background: mixColor(dark ? "070B12" : "FFFFFF", color, dark ? 0.28 : 0.12),
    forest: mixColor("11151B", color, 0.38),
    paper: mixColor(dark ? "0D121A" : "FFFFFF", color, dark ? 0.34 : 0.19),
    pale: mixColor(dark ? "10161E" : "FFFFFF", color, dark ? 0.4 : 0.23),
    sage: mixColor(dark ? "0D121A" : "FFFFFF", color, dark ? 0.36 : 0.28),
    mint: mixColor("FFFFFF", color, 0.35),
    muted: mixColor(dark ? "FFFFFF" : "0B1218", color, 0.34),
    line: mixColor(dark ? "515761" : "D6D9DA", color, 0.4)
  };
}

function mixColor(base, color, strength) {
  return [0, 2, 4].map(offset => {
    const baseChannel = parseInt(base.slice(offset, offset + 2), 16);
    const channel = parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(baseChannel + (channel - baseChannel) * strength).toString(16).padStart(2, "0");
  }).join("").toUpperCase();
}

function rect(x, y, w, h, color) {
  return { kind: "rect", x, y, w, h, color };
}

function text(value, x, y, w, h, size, color, bold = false) {
  return { kind: "text", value, x, y, w, h, size, color, bold };
}

function editable(field, ...styleAndText) {
  return { ...text(...styleAndText), field };
}

const sectionLabels = {
  summary: "项目概览",
  metrics: "关键指标",
  progress: "本期进展",
  risk: "风险与应对",
  actions: "下一步",
  decision: "待决策事项"
};

function metricComparisons(point) {
  // Recognize an explicit same-unit relationship, never infer the business metric.
  return [...point.matchAll(/(?<![\d.,+-])([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(分钟|小时|秒|%|单|件|份|条|人|天)\s*(?:缩短至|缩短到|降至|降到|增至|增到|升至|升到|到)\s*([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*\2/g)];
}

function metricComparison(point) {
  const matches = metricComparisons(point);
  return matches.length === 1 ? matches[0] : undefined;
}

function metricValue(point) {
  const comparison = metricComparison(point);
  if (comparison) return `${comparison[1]} → ${comparison[3]} ${comparison[2]}`;
  return point.match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:[%％]|分钟|小时|秒|单|件|条|人|天|倍|万元|元)/)?.[0] ?? "";
}

function evidenceComparison(point) {
  const matches = metricComparisons(point);
  const arrows = [...point.matchAll(/(?<![\d.,+\-−])([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(分钟|小时|秒|%|％|单|件|份|条|人|天)?\s*→\s*([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(分钟|小时|秒|%|％|单|件|份|条|人|天)/g)];
  if (matches.length + arrows.length !== 1) return undefined;
  const match = matches[0];
  if (match) return { phrase: match[0], index: match.index, before: match[1], unit: match[2], after: match[3] };
  const arrow = arrows[0];
  if (!arrow || (arrow[2] && arrow[2] !== arrow[4])) return undefined;
  return { phrase: arrow[0], index: arrow.index, before: arrow[1], unit: arrow[4], after: arrow[3] };
}

function evidenceValue(value) {
  const comparison = evidenceComparison(value);
  if (comparison) return `${comparison.before} → ${comparison.after} ${comparison.unit}`;
  const matches = value.match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:[%％]|分钟|小时|秒|单|件|份|条|人|天|倍|万元|元)/g);
  return matches?.length === 1 ? matches[0] : "";
}

function evidenceNote(point, value) {
  if (!value) return point;
  const core = point.trim().replace(/[。.!！]$/, "").trim();
  if (core.replace(/\s/g, "") === value.replace(/\s/g, "")) return "";
  // Only separate a trailing value explicitly introduced as a label.
  const label = core.match(/^([^：:]+)[：:]\s*(.+)$/);
  if (label && label[2].replace(/\s/g, "") === value.replace(/\s/g, "")) return label[1];
  const comparison = evidenceComparison(core);
  if (comparison && comparison.index + comparison.phrase.length === core.length) {
    const context = core.slice(0, comparison.index);
    if (!context || /[由从]\s*$/.test(context)) {
      const label = context.replace(/[由从]\s*$/, "").trim();
      if (!/(拟|将|计划|预计|建议)$/.test(label)) return label;
    }
  }
  const clause = core.match(/^([^，、；。]+)[，；]\s*(.+)$/);
  if (clause?.[1].endsWith(value)) {
    const label = clause[1].slice(0, -value.length).trim();
    if (/(处理|完成|覆盖|受理|交付|抽检|复核)$/.test(label) && !/(预计|计划|拟|目标|至少|至多|不足|不超过)/.test(label)) {
      return `${label} · ${clause[2]}。`;
    }
  }
  return point;
}

function evidenceChange(point) {
  const comparison = evidenceComparison(point);
  if (!comparison || /[%％]/.test(comparison.unit)) return "";
  const before = Number(comparison.before.replaceAll(",", ""));
  const after = Number(comparison.after.replaceAll(",", ""));
  if (before <= 0 || after < 0 || before === after) return "";
  if ((/降|缩短/.test(comparison.phrase) && after > before) || (/升|增/.test(comparison.phrase) && after < before)) return "";
  const percentage = Math.round(Math.abs((after - before) / before) * 100);
  if (percentage < 1 || percentage > 9999) return "";
  const direction = after > before ? "上升" : /^(分钟|小时|秒)$/.test(comparison.unit) ? "缩短" : "下降";
  return `${direction}约 ${percentage}%`;
}

function featuredMetric(points, lead, palette) {
  const main = points[lead];
  const value = evidenceValue(main);
  const featured = value.length <= 24 ? value : "";
  const w = points.length === 1 ? 12.03 : 7.55;
  const elements = [
    rect(0.65, 2.46, w, 3.75, palette.forest),
    rect(0.65, 2.46, 0.065, 3.75, palette.accent),
    text(featured, 0.98, 2.86, w - 0.66, 1.12, featured.length > 14 ? 29 : 39, palette.mint, true),
    text(featured ? evidenceChange(main) : "", 0.98, 4.04, w - 0.66, 0.48, 19, palette.white, true),
    editable(lead, evidenceNote(main, featured), 0.98, featured ? 4.72 : 2.8, w - 0.66,
      featured ? 1.08 : 3.02, featured ? 16 : 24, palette.white, !featured)
  ];
  let row = 0;
  for (const [field, point] of points.entries()) {
    if (field === lead) continue;
    const y = 2.48 + row++ * 1.88;
    const height = points.length === 2 ? 3.73 : 1.73;
    const metric = evidenceValue(point);
    const shortValue = metric.length <= 14 ? metric : "";
    elements.push(
      rect(8.48, y + height, 4.2, 0.012, palette.line),
      text(shortValue, 8.48, y + 0.03, 4.2, 0.55, 24, palette.heading, true),
      editable(field, evidenceNote(point, shortValue), 8.48, y + (shortValue ? 0.64 : 0.10), 4.2,
        height - (shortValue ? 0.7 : 0.2), 15, palette.ink)
    );
  }
  return elements;
}

function decisionSummary(points, lead, palette) {
  const support = points.map((value, field) => ({ value, field })).filter(item => item.field !== lead);
  const width = support.length ? 7.55 : 12.03;
  return [
    rect(0.65, 2.46, width, 3.75, palette.forest),
    rect(0.65, 2.46, 0.065, 3.75, palette.accent),
    text("当前建议", 0.98, 2.72, width - 0.66, 0.4, 15, palette.mint, true),
    editable(lead, points[lead].replace(/^当前建议[：:]\s*/, ""), 0.98, 3.35, width - 0.66, 2.46, 22, palette.white, true),
    ...support.flatMap(({ value, field }, index) => {
      const y = 2.48 + index * 1.88;
      const height = support.length === 1 ? 3.73 : 1.73;
      return [
        text(index === 0 ? "决策条件与依据" : "补充依据", 8.48, y, 4.2, 0.4, 14, palette.muted, true),
        editable(field, value, 8.48, y + 0.55, 4.2, height - 0.65, 17, palette.ink),
        rect(8.48, y + height, 4.2, 0.012, palette.line)
      ];
    })
  ];
}

function columns(points, metrics, palette) {
  const width = (12.03 - 0.22 * (points.length - 1)) / points.length;
  return points.flatMap((point, i) => {
    const x = 0.65 + i * (width + 0.22);
    const card = rect(x, 2.47, width, 3.75, metrics ? palette.forest : palette.sage);
    if (!metrics) {
      return [
        card,
        rect(x + 0.25, 2.79, 0.58, 0.05, palette.accent),
        editable(i, point, x + 0.25, 3.04, width - 0.5, 2.65, 21, palette.heading, true)
      ];
    }
    const value = metricValue(point);
    return [
      card,
      rect(x, 2.47, width, 0.06, palette.accent),
      text(value, x + 0.25, 2.91, width - 0.5, 1.25, value.length > 13 || !value ? 25 : 32, palette.mint, true),
      editable(i, point, x + 0.25, value ? 4.25 : 3.02, width - 0.5, value ? 1.62 : 2.7, 17, palette.white)
    ];
  });
}

function featuredPoints(points, risk, palette) {
  const [first, ...support] = points;
  const featuredWidth = support.length ? 7.04 : 12.03;
  return [
    rect(0.65, 2.48, featuredWidth, 3.7, risk ? palette.amber : palette.forest),
    rect(0.65, 2.48, 0.07, 3.7, palette.accent),
    editable(0, first, 0.98, 2.78, featuredWidth - 0.66, 3.02, 24, risk ? palette.umber : palette.white, true),
    ...support.flatMap((point, i) => {
      const y = 2.48 + i * 1.9;
      const height = support.length === 1 ? 3.7 : 1.8;
      return [
        rect(7.92, y, 4.76, height, palette.paper),
        editable(i + 1, point, 8.18, y + 0.16, 4.24, height - 0.32, 18, palette.ink)
      ];
    })
  ];
}

function actionList(points, palette) {
  return points.flatMap((point, i) => {
    const y = 2.49 + i * 1.19;
    return [
      rect(0.65, y + 0.08, 0.7, 0.78, palette.forest),
      rect(0.65, y + 0.08, 0.7, 0.05, palette.accent),
      text(String(i + 1).padStart(2, "0"), 0.78, y + 0.08, 0.45, 0.78, 17, palette.mint, true),
      editable(i, point, 1.62, y, 11.06, 0.98, 20, palette.ink),
      rect(1.62, y + 1.07, 11.06, 0.012, palette.line)
    ];
  });
}

function summaryRows(points, palette) {
  return points.flatMap((point, i) => {
    const y = 2.46 + i * 1.22;
    return [
      rect(0.65, y, 12.03, 1.08, i % 2 ? palette.paper : palette.pale),
      rect(0.65, y, 0.052, 1.08, palette.accent),
      editable(i, point, 0.94, y + 0.06, 11.38, 0.96, 20, palette.ink)
    ];
  });
}

function metricRows(points, palette) {
  return points.flatMap((point, i) => {
    const y = 2.46 + i * 1.22;
    const value = metricValue(point);
    const labelWidth = value ? 3.15 : 0;
    return [
      rect(0.65, y, 12.03, 1.08, palette.forest),
      rect(0.65, y, 0.065, 1.08, palette.accent),
      text(value, 0.92, y + 0.05, 2.9, 0.98, value.length > 13 ? 18 : 23, palette.mint, true),
      editable(i, point, 0.92 + labelWidth, y + 0.05, 11.49 - labelWidth, 0.98, 17, palette.white)
    ];
  });
}

function drawComparison(pointIndex, value, { x, y, w, h }, palette) {
  const match = metricComparison(value);
  const labels = match ? [match[1], match[3]] : ["", ""];
  const numbers = labels.map(label => Number(label.replaceAll(",", "")));
  const hasBars = match && labels.every(label => label.length <= 6) && numbers.every(number => number >= 0);
  const maximum = Math.max(...numbers) || 1;
  return [
    rect(x, y, w, h, palette.forest),
    ...numbers.flatMap((number, index) => {
      const top = y + 0.14 + index * 0.46;
      const barWidth = hasBars ? Math.max(0.04, (w - 2.65) * number / maximum) : 0.04;
      return [
        text(hasBars ? `${index === 0 ? "前" : "后"}  ${labels[index]} ${match[2]}` : "", x + 0.18, top, 2.08, 0.4, 14, palette.white, true),
        rect(x + 2.48, top + 0.09, barWidth, 0.21, hasBars ? (index === 0 ? palette.line : palette.accent) : palette.forest)
      ];
    }),
    editable(pointIndex, value, x + 0.18, y + (hasBars ? 1.05 : 0.12), w - 0.36, h - (hasBars ? 1.17 : 0.24), 16, palette.white)
  ];
}

function timelineTrack(blocks, palette) {
  const stages = blocks.filter(block => block.kind === "milestone");
  if (stages.length < 2 || !stages.every(stage => stage.y === stages[0].y)) return [];
  const centers = stages.map(stage => stage.x + stage.w / 2);
  const y = stages[0].y - 0.09;
  const left = Math.min(...centers);
  return [
    rect(left, y, Math.max(...centers) - left, 0.028, palette.accent),
    ...centers.map(x => rect(x - 0.052, y - 0.04, 0.104, 0.104, palette.accent))
  ];
}

function renderDesign(slide, palette) {
  const blocks = slide.design.map(block => ({
    ...block,
    x: 0.65 + block.x * 12.03 / designGrid + 0.05,
    y: 2.38 + block.y * 4.07 / designGrid + 0.05,
    w: block.w * 12.03 / designGrid - 0.1,
    h: block.h * 4.07 / designGrid - 0.1
  }));
  const elements = blocks.flatMap(block => {
    const { point, kind, x, y, w, h } = block;
    const value = slide.points[point];
    if (kind === "compare") return drawComparison(point, value, block, palette);
    if (kind === "milestone") {
      return [
        rect(x, y, w, h, palette.sage),
        rect(x, y, w, 0.06, palette.accent),
        text(String(point + 1).padStart(2, "0"), x + 0.18, y + 0.13, 0.65, 0.43, 21, palette.heading, true),
        rect(x + 0.9, y + 0.34, w - 1.08, 0.025, palette.line),
        editable(point, value, x + 0.18, y + 0.61, w - 0.36, h - 0.72, 16, palette.ink)
      ];
    }
    const emphasized = kind === "focus";
    return [
      rect(x, y, w, h, emphasized ? palette.forest : palette.paper),
      rect(x, y, 0.065, h, palette.accent),
      editable(point, value, x + 0.18, y + 0.12, w - 0.36, h - 0.24,
        emphasized && w >= 5 && h >= 2 ? 23 : 16, emphasized ? palette.white : palette.ink, emphasized)
    ];
  });
  return [...timelineTrack(blocks, palette), ...elements];
}

function bodyElements(name, points, palette, composition) {
  if (name === "metrics" && composition === "stack") return metricRows(points, palette);
  if (composition === "stack") return summaryRows(points, palette);
  if (composition === "cards") return columns(points, name === "metrics", palette);
  if (composition === "spotlight" && name !== "metrics") return featuredPoints(points, name === "risk", palette);
  switch (name) {
    case "metrics": return columns(points, true, palette);
    case "progress": return columns(points, false, palette);
    case "risk": return featuredPoints(points, true, palette);
    case "decision": return featuredPoints(points, false, palette);
    case "actions": return actionList(points, palette);
    default: return summaryRows(points, palette);
  }
}

export function placePicture(picture, index) {
  const scale = Math.min(2.65 / picture.width, 1.2 / picture.height);
  const w = picture.width * scale;
  const h = picture.height * scale;
  const column = index % 4;
  const rowOffset = Math.floor(index / 4) % 5 * 0.2;
  return { x: dimensions.width - w - 0.65 - column * 2.85, y: 6.25 - rowOffset, w, h };
}

export function movePicture({ x, y, w, h }, dx, dy) {
  return {
    x: Math.max(0, Math.min(dimensions.width - w, x + dx)),
    y: Math.max(0, Math.min(dimensions.height - h, y + dy)),
    w, h
  };
}

export function resizePicture({ x, y, w, h }, dx, dy) {
  const widthChange = dx / w;
  const heightChange = dy / h;
  const change = Math.abs(widthChange) > Math.abs(heightChange) ? widthChange : heightChange;
  const minimum = 0.25 / Math.max(w, h);
  const maximum = Math.min((dimensions.width - x) / w, (dimensions.height - y) / h);
  const scale = Math.min(maximum, Math.max(minimum, 1 + change));
  return { x, y, w: w * scale, h: h * scale };
}

export function pictureElement(picture) {
  return { kind: "image", picture, ...picture.frame };
}

export function slideLayout(slide, index, total, style = {}) {
  const palette = themePalette(style.theme, style.accent);
  const technical = style.theme === "technology";
  const page = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const pictures = (slide.pictures ?? []).map(pictureElement);
  if (index === 0) {
    return {
      name: "cover",
      background: palette.forest,
      elements: [
        ...(technical
          ? [rect(0.65, 0.56, 1.22, 0.08, palette.accent), rect(1.97, 0.56, 0.22, 0.08, palette.accent)]
          : [rect(0.65, 0.56, 0.47, 0.08, palette.accent)]),
        text("项目进展汇报", 0.65, 0.78, 8, 0.4, 18, palette.mint, true),
        editable("title", slide.title, 0.65, 2.03, 11.98, 2.45, 40, palette.white, true),
        editable(0, slide.points[0], 0.65, 4.63, 11.98, 1.01, 19, palette.mint),
        rect(0.65, 6.65, 12.03, 0.014, "5A8172"),
        text(page, 0.65, 6.8, 4, 0.36, 12, palette.mint),
        ...pictures
      ]
    };
  }
  const name = Object.hasOwn(sectionLabels, slide.layout) ? slide.layout : "summary";
  const lead = primaryEvidence(slide);
  const highlighted = lead !== undefined;
  const body = highlighted ? (name === "decision" ? decisionSummary(slide.points, lead, palette) : featuredMetric(slide.points, lead, palette)) :
    slide.design ? renderDesign(slide, palette) : bodyElements(name, slide.points, palette, slide.composition);
  return {
    name,
    background: palette.background,
    elements: [
      ...(technical ? [rect(0.36, 0.46, 0.065, 1.79, palette.accent), rect(11.93, 0.55, 0.75, 0.045, palette.accent)] : []),
      text(sectionLabels[name], 0.65, 0.46, 9.75, 0.44, 17, palette.muted, true),
      editable("title", slide.title, 0.65, 0.96, 12.03, 1.32, 29, palette.heading, true),
      ...body,
      rect(0.65, 6.65, 12.03, 0.014, palette.line),
      text(page, 0.65, 6.8, 4, 0.36, 12, palette.muted),
      ...pictures
    ]
  };
}
