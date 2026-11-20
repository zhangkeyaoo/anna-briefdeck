import { designGrid, parseSlideDesign, primaryEvidence } from "./slide-design.js";
import { formatMetricNumber, metricIsStale, resolveAuxMetrics, resolveMetric } from "./metric.js";
import { relationshipPlan, renderRelationship } from "./relationships.js";
import { bodyReadable, densityPlans, renderDensity, wrapDensityText } from "./density.js";

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

function metricChange(metric) {
  const [before, after] = metric.numbers;
  if (metric.basis === "target") {
    if (before === after) return "与目标数值相同";
    const unit = ["%", "％"].includes(metric.unit) ? "个百分点" : metric.unit;
    return `${before < after ? "低于" : "高于"}目标 ${formatMetricNumber(Math.abs(before - after), 6)} ${unit}`;
  }
  if (before === after) return "前后数值相同";
  if (before === 0) return "基线为 0，不计算相对变化";
  const direction = after > before ? "增加" : "减少";
  if (["%", "％"].includes(metric.unit)) return `${direction} ${formatMetricNumber(Math.abs(after - before), 6)} 个百分点`;
  const percent = Math.abs((after - before) / before) * 100;
  if (!Number.isFinite(percent)) return "不计算相对变化";
  const verb = after < before && ["分钟", "小时", "秒"].includes(metric.unit) ? "缩短" : direction;
  if (percent < 0.01) return "相对变化小于 0.01%";
  return `${verb}约 ${formatMetricNumber(percent < 1 ? percent : Math.round(percent), percent < 1 ? 2 : 0)}%`;
}

function relationBody(slide, metric, palette) {
  const support = slide.points.map((value, field) => ({ value, field })).filter(item => item.field !== metric.point);
  const width = support.length ? 7.55 : 12.03;
  const parts = [text(`${metric.label} · 单位：${metric.unit}`, 0.65, 2.42, width, 0.42, 16, palette.muted, true)];
  const number = metric.texts;
  if (metric.kind === "comparison") {
    const value = `${number[0]} ${metric.basis === "target" ? "/" : "→"} ${number[1]} ${metric.unit}`;
    parts.push(text(value, 0.65, 2.98, width, 0.8, value.length > 20 ? 26 : 36, palette.heading, true));
    const maximum = Math.max(...metric.numbers) || 1;
    for (const [i, value] of metric.numbers.entries()) {
      const y = 4.0 + i * 0.52;
      const trackWidth = width - 2.12;
      const barWidth = trackWidth * value / maximum;
      parts.push(
        text(`${metric.basis === "target" ? (i === 0 ? "当前" : "目标") : (i === 0 ? "之前" : "之后")} ${number[i]}`, 0.65, y, 1.96, 0.4, number[i].length > 12 ? 11 : 14, palette.ink),
        { ...rect(2.77, y + 0.08, trackWidth, 0.22, palette.pale), metricPart: `track-${i}` },
        ...(barWidth >= 1 / 914400 ? [{ ...rect(2.77, y + 0.08, barWidth, 0.22, i === 0 ? palette.muted : palette.accent), metricPart: `bar-${i}` }] : [])
      );
    }
    parts.push(text(metricChange(metric), 0.65, 5.15, width, 0.38, 17, palette.heading, true));
  } else if (metric.kind === "completion") {
    const [completed, total] = metric.numbers;
    const percentage = completed / total * 100;
    const value = `${number[0]} / ${number[1]} ${metric.unit}`;
    const fillWidth = width * Math.min(1, completed / total);
    parts.push(
      text(value, 0.65, 2.98, width, 0.8, value.length > 23 ? 24 : 34, palette.heading, true),
      text(`完成率 ${metric.rate ?? `${formatMetricNumber(percentage)}%`}`, 0.65, 3.94, width, 0.46, 24, palette.heading, true),
      { ...rect(0.65, 4.65, width, 0.3, palette.pale), metricPart: "progress-track" },
      ...(fillWidth >= 1 / 914400 ? [{ ...rect(0.65, 4.65, fillWidth, 0.3, palette.accent), metricPart: "progress-fill" }] : []),
      text(completed > total ? `超出总量 ${formatMetricNumber(completed - total, 6)} ${metric.unit}` :
        `剩余 ${formatMetricNumber(total - completed, 6)} ${metric.unit}`, 0.65, 5.15, width, 0.38, 17, palette.muted)
    );
  } else {
    const value = `${number[0]} ${metric.unit}`;
    parts.push(text(value, 0.65, 3.16, width, 1.1, value.length > 16 ? 30 : 44, palette.heading, true));
  }
  parts.push(editable(metric.point, slide.points[metric.point], 0.65, 5.64, width, 0.82, 14, palette.ink));
  for (const [i, { value, field }] of support.entries()) {
    const y = 2.48 + i * 1.94;
    const height = support.length === 1 ? 3.86 : 1.8;
    parts.push(
      text("辅助依据", 8.48, y, 4.2, 0.32, 13, palette.muted, true),
      editable(field, value, 8.48, y + 0.43, 4.2, height - 0.57, 15, palette.ink),
      rect(8.48, y + height, 4.2, 0.012, palette.line)
    );
  }
  return fitDisplayText(parts);
}

function columns(points, metrics, palette, valueReader = metricValue) {
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
    const value = valueReader(point);
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
  return [...timelineTrack(blocks, palette), ...elements].map(wrapNarrativeText);
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

function originalNarrativeBody(slide, name, palette) {
  const lead = primaryEvidence(slide);
  return lead !== undefined ? (name === "decision" ? decisionSummary(slide.points, lead, palette) : featuredMetric(slide.points, lead, palette)) :
    slide.design ? renderDesign(slide, palette) : bodyElements(name, slide.points, palette, slide.composition);
}

function requiresDensity(slide, name, palette) {
  const stages = slide.design;
  const outOfOrder = ["progress", "actions"].includes(name) && stages?.length &&
    ![...stages].sort((a, b) => a.y - b.y || a.x - b.x).every((block, i) => block.point === i);
  const body = originalNarrativeBody(slide, name, palette);
  return outOfOrder || !hasEveryPoint(body, slide.points.length) || !bodyReadable(body);
}

function hasEveryPoint(elements, count) {
  const fields = elements.filter(item => Number.isInteger(item.field)).map(item => item.field).sort((a, b) => a - b);
  return fields.length === count && fields.every((field, i) => field === i);
}

function narrativeBody(slide, name, palette) {
  const relation = relationshipPlan(slide);
  if (relation.cells) return renderRelationship(relation, palette);
  if (!requiresDensity(slide, name, palette)) return originalNarrativeBody(slide, name, palette);
  const selected = densityPlans(slide)[0];
  if (!selected) throw new Error("本页内容无法在可读字号内完整排下，请减少内容密度。原文未被截断。");
  return renderDensity(selected, slide, palette);
}

function primaryMetricFits(slide, metric) {
  const support = slide.points.length - 1;
  if (support > 0 && (support - 1) * 1.94 + (support === 1 ? 3.86 : 1.8) > 4.05) return false;
  const lead = primaryEvidence(slide);
  return slide.layout === "metrics" && (lead === metric.point || (lead === undefined && !slide.design));
}

function compactMetric(metric, frame, palette, color) {
  const { x, y, w } = frame;
  const unitValue = value => `${value}${["%", "％"].includes(metric.unit) ? "" : " "}${metric.unit}`;
  const caption = metric.kind === "completion" ? `${unitValue(metric.texts[0])} / ${unitValue(metric.texts[1])} · ${metric.rate ?? `${formatMetricNumber(metric.numbers[0] / metric.numbers[1] * 100)}%`}` :
    `${metric.label}：${unitValue(metric.texts[0])}`;
  if (metric.kind === "single") {
    if (caption.length > Math.floor(w * 72 / 17) - 2) return undefined;
    return [text(caption, x, y, w, 0.46, 17, color, true)];
  }
  if (metric.kind === "completion") {
    if (caption.length > Math.floor(w * 72 / 13) - 2) return undefined;
    const [completed, total] = metric.numbers;
    const fill = w * Math.min(1, completed / total);
    return [
      text(caption, x, y, w, 0.3, 13, color, true),
      { ...rect(x, y + 0.43, w, 0.14, palette.line), metricPart: "progress-track" },
      ...(fill >= 1 / 914400 ? [{ ...rect(x, y + 0.43, fill, 0.14, palette.accent), metricPart: "progress-fill" }] : []),
      text(completed > total ? `超出总量 ${formatMetricNumber(completed - total, 6)} ${metric.unit}` :
        `剩余 ${formatMetricNumber(total - completed, 6)} ${metric.unit}`, x, y + 0.73, w, 0.28, 12, color)
    ];
  }
  const labels = metric.texts.map((value, i) => `${metric.basis === "target" ? (i === 0 ? "当前" : "目标") : (i === 0 ? "之前" : "之后")} ${unitValue(value)}`);
  if (labels.some(label => label.length > Math.floor(1.75 * 72 / 12) - 1)) return undefined;
  const maximum = Math.max(...metric.numbers) || 1;
  return [
    ...metric.numbers.flatMap((value, i) => {
      const top = y + i * 0.34;
      const fill = (w - 1.85) * value / maximum;
      return [
        text(labels[i], x, top, 1.75, 0.28, 12, color),
        { ...rect(x + 1.85, top + 0.07, w - 1.85, 0.13, palette.line), metricPart: `track-${i}` },
        ...(fill >= 1 / 914400 ? [{ ...rect(x + 1.85, top + 0.07, fill, 0.13, palette.accent), metricPart: `bar-${i}` }] : [])
      ];
    }),
    text(metricChange(metric), x, y + 0.73, w, 0.28, 12, color, true)
  ];
}

// Attach to one existing text region, preserving all other geometry and narrative emphasis.
function metricBody(slide, name, palette) {
  const metric = resolveMetric(slide);
  if (!metric || slide.design?.some(block => block.point === metric.point && ["compare", "milestone"].includes(block.kind))) return undefined;
  if (primaryMetricFits(slide, metric)) {
    let body = relationBody(slide, metric, palette).map(item => ({ ...item, component: "metric-main", metricPoint: metric.point }));
    for (const auxiliary of resolveAuxMetrics(slide)) body = attachAuxiliary(body, auxiliary, palette);
    return body;
  }
  const originalBody = narrativeBody(slide, name, palette);
  const original = originalBody.find(item => item.field === metric.point);
  if (!original || original.w < 3.1) return undefined;
  const source = fitDisplayText([original])[0];
  const height = metric.kind === "single" ? 0.5 : 1.01;
  const textHeight = original.h - height - 0.12;
  const capacity = Math.max(1, Math.floor(source.w * 72 / source.size) - 2);
  const lines = source.value.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / capacity)), 0);
  if (textHeight < lines * source.size * 1.3 / 72 + 0.12) return undefined;
  const graphic = compactMetric(metric, { x: source.x, y: source.y + textHeight + 0.12, w: source.w }, palette, source.color);
  if (!graphic) return undefined;
  const body = originalBody.map(item => item === original ? item : wrapNarrativeText(item));
  return body.flatMap(item => item === original ? [{ ...source, h: textHeight }, ...graphic] : [item]);
}

function attachAuxiliary(body, metric, palette) {
  const original = body.find(item => item.field === metric.point);
  if (!original || original.w < 3.5) return body;
  const font = 14;
  const value = wrapDensityText(metric.sourceText, original.w, font);
  const textHeight = value.split("\n").length * font * 1.3 / 72;
  const graphHeight = metric.kind === "single" ? 0.34 : metric.kind === "completion" ? 0.43 : 0.54;
  if (textHeight + 0.04 + graphHeight > original.h) return body;
  const { x, w } = original;
  const y = original.y + textHeight + 0.04;
  let graphics;
  if (metric.kind === "comparison") {
    const maximum = Math.max(...metric.numbers) || 1;
    const prefix = metric.basis === "target" ? ["当前", "目标"] : ["之前", "之后"];
    const captions = metric.texts.map((number, i) => `${prefix[i]} ${number}${metric.unit}`);
    if (captions.some(caption => caption.length > 14)) return body;
    graphics = metric.numbers.flatMap((number, i) => [
      text(captions[i], x, y + i * 0.27, 2.0, 0.24, 12, palette.ink),
      rect(x + 2.08, y + i * 0.27 + 0.08, w - 2.08, 0.09, palette.line),
      ...(number > 0 ? [rect(x + 2.08, y + i * 0.27 + 0.08, (w - 2.08) * number / maximum, 0.09, palette.accent)] : [])
    ]);
  } else if (metric.kind === "completion") {
    const caption = `${metric.texts[0]} / ${metric.texts[1]} ${metric.unit} · ${metric.rate ?? `${formatMetricNumber(metric.numbers[0] / metric.numbers[1] * 100)}%`}`;
    if (caption.length > Math.floor(w * 72 / 12) - 2) return body;
    graphics = [text(caption, x, y, w, 0.24, 12, palette.ink, true), rect(x, y + 0.30, w, 0.09, palette.line),
      ...(metric.numbers[0] > 0 ? [rect(x, y + 0.30, w * Math.min(1, metric.numbers[0] / metric.numbers[1]), 0.09, palette.accent)] : [])];
  } else {
    const caption = `${metric.texts[0]} ${metric.unit}`;
    if (caption.length > Math.floor(w * 72 / 17) - 2) return body;
    graphics = [text(caption, x, y, w, 0.34, 17, palette.heading, true)];
  }
  return body.flatMap(item => item === original ? [
    { ...original, value, size: font, h: textHeight },
    ...graphics.map(item => ({ ...item, component: `metric-aux:${metric.kind}`, metricPoint: metric.point }))
  ] : [item]);
}

function wrapNarrativeText(item) {
  const wrapped = fitDisplayText([item], true)[0];
  const lines = wrapped.value?.split("\n").length ?? 0;
  return lines * (wrapped.size ?? 0) * 1.3 / 72 + 0.06 <= wrapped.h ? wrapped : item;
}

function baseLayoutOptions(slide, index) {
  if (index === 0 || !Array.isArray(slide?.points) || slide.points.length < 1) return [];
  const name = Object.hasOwn(sectionLabels, slide.layout) ? slide.layout : "summary";
  const relation = relationshipPlan(slide);
  if (relation.cells) return [
    { id: relation.id, label: relation.label, description: relation.reason },
    ...densityPlans(slide).filter(plan => plan.id !== "density-focus").map(plan => ({ id: plan.id, label: plan.id === "density-list" ? "顺序列表" : "分栏要点", description: "保留全部原文和原始顺序。" }))
  ].slice(0, 3);
  if (requiresDensity(slide, name, minimal) || (typeof slide.manualLayout === "string" && slide.manualLayout.startsWith("density-"))) {
    return densityPlans(slide).slice(0, 3).map(item => ({
      id: item.id, label: item.id === "density-list" ? "顺序列表" : item.id === "density-grid" ? "分栏要点" : "首条重点",
      description: item.id === "density-list" ? "按原顺序逐条呈现完整内容。" : item.id === "density-grid" ? "按阅读顺序分栏，适配内容密度。" : "突出第01条要点，保留其编号与后续要点顺序。"
    }));
  }
  if (metricIsStale(slide)) return name === "metrics" ? [{ id: "plain", label: "简洁文字", description: "来源已修改，停用旧指标并保留全文。" }] : [];
  const metric = resolveMetric(slide);
  const compatible = metric && metricBody(slide, name, minimal);
  if (compatible && !primaryMetricFits(slide, metric)) return [
    { id: metric.kind === "single" ? "metric-focus" : "metric-relation", label: metric.kind === "single" ? "核心数值辅助" : "数据关系辅助", description: "在来源要点区域加入辅助图，保留本页叙事重点。" },
    { id: "narrative", label: "原有叙事布局", description: "保留原有设计及完整文字，不加入指标组件。" }
  ];
  if (!["metrics", "summary"].includes(name)) return [];
  const options = [];
  if (name === "metrics") {
    const lead = primaryEvidence(slide);
    if (compatible && metric.kind !== "single") {
      options.push({ id: "metric-relation", label: "数据关系可视化", description: metric.kind === "comparison" ? "同一尺度比较前后数值。" : "展示完成量、总量与完成进度。" });
    } else if (compatible || (lead !== undefined && evidenceValue(slide.points[lead]))) {
      options.push({ id: "metric-focus", label: "重点指标", description: "突出原主证据，其余信息作为辅助。" });
    }
    if (slide.points.length > 1) options.push({ id: "metric-cards", label: "并列展示", description: "各条指标并列，保留完整口径。" });
  } else if (slide.points.length > 1) {
    options.push({ id: "summary-focus", label: "突出首条", description: "强调第一条内容，其余要点在侧边呈现。" });
    options.push({ id: "summary-cards", label: "并列展示", description: "各条要点并列，适合没有明确主次的内容。" });
  }
  options.push({ id: "plain", label: "简洁文字", description: "按原顺序逐条展示完整文字。" });
  return options.filter(option => {
    const elements = manualBody({ ...slide, manualLayout: option.id }, index, minimal, false);
    return elements && bodyReadable(elements);
  });
}

export function canUseCustomDesign(slide) {
  if(!Array.isArray(slide.design))return false;
  const design=parseSlideDesign(slide.design.map(block=>[block?.point,block?.kind,block?.x,block?.y,block?.w,block?.h]),slide.points.length);
  if(!design || design.some(block=>!["text","focus"].includes(block.kind)))return false;
  const body=renderDesign({...slide,design},minimal);
  return bodyReadable(body)&&hasEveryPoint(body,slide.points.length);
}

export function canUseBaseDesign(slide) {
  const name=Object.hasOwn(sectionLabels,slide.layout)?slide.layout:"summary";
  const body=originalNarrativeBody(slide,name,minimal);
  return bodyReadable(body)&&hasEveryPoint(body,slide.points.length);
}

export function layoutOptions(slide,index) {
  const options=baseLayoutOptions(slide,index);
  if(index>0 && (slide.manualLayout==="ai-design" || slide.redesignTrace?.customGrid===true) && canUseCustomDesign(slide)) {
    const plain=options.find(option=>["plain","density-list"].includes(option.id));
    const alternatives=plain?[...options.filter(option=>option!==plain).slice(0,1),plain]:options.slice(0,2);
    return [{id:"ai-design",label:"AI设计",description:"已确认的单页网格设计，保留全部原文。"},...alternatives];
  }
  return options;
}

export function withLayoutChoice(slide, index, total, choice, style = {}) {
  if (!layoutOptions(slide, index).some(option => option.id === choice)) throw new Error("当前页面不适合这个布局，请选择其他布局。");
  const candidate = { ...slide, manualLayout: choice };
  const layout = slideLayout(candidate, index, total, style);
  for (const item of layout.elements.filter(item => item.kind !== "image")) {
    if (![item.x, item.y, item.w, item.h].every(Number.isFinite) || item.w <= 0 || item.h <= 0 ||
        item.x < 0 || item.y < 0 || item.x + item.w > dimensions.width + 0.001 || item.y + item.h > dimensions.height + 0.001) {
      throw new Error("该布局超出页面边界，已保留原布局。");
    }
  }
  const fields = layout.elements.filter(item => Number.isInteger(item.field)).map(item => item.field).sort((a, b) => a - b);
  if (fields.length !== slide.points.length || fields.some((field, i) => field !== i)) throw new Error("该布局不能完整保留内容，已保留原布局。");
  return candidate;
}

function manualBody(slide, index, palette, check = true) {
  if (check && !layoutOptions(slide, index).some(option => option.id === slide.manualLayout)) return undefined;
  if (["relation-roles", "relation-sequence"].includes(slide.manualLayout)) {
    const relation = relationshipPlan(slide);
    return relation.id === slide.manualLayout && relation.cells ? renderRelationship(relation, palette) : undefined;
  }
  if (typeof slide.manualLayout === "string" && slide.manualLayout.startsWith("density-")) {
    const selected = densityPlans(slide).find(item => item.id === slide.manualLayout);
    return selected ? renderDensity(selected, slide, palette) : undefined;
  }
  let elements;
  switch (slide.manualLayout) {
    case "ai-design": return canUseCustomDesign(slide) ? renderDesign(slide,palette).map(item=>({...item,component:"ai-redesign"})) : undefined;
    case "metric-relation": return metricBody(slide, slide.layout, palette);
    case "narrative": return narrativeBody(slide, slide.layout, palette).map(wrapNarrativeText);
    case "metric-focus": {
      const visual = metricBody(slide, slide.layout, palette);
      if (visual) return visual;
      elements = featuredMetric(slide.points, primaryEvidence(slide), palette);
      break;
    }
    case "metric-cards": elements = columns(slide.points, true, palette, evidenceValue); break;
    case "summary-focus": elements = featuredPoints(slide.points, false, palette); break;
    case "summary-cards": elements = columns(slide.points, false, palette); break;
    case "plain": elements = summaryRows(slide.points, palette); break;
  }
  return fitDisplayText(elements);
}

function fitDisplayText(elements, keepSize = false) {
  return elements?.map(item => {
    if (!Number.isInteger(item.field) || (!keepSize && item.value.length <= 44)) return item;
    const size = keepSize ? item.size : Math.max(14, item.size - (item.size >= 20 ? 2 : 1));
    // Explicit display-only line breaks leave two full-width glyphs of wrapping margin.
    // PowerPoint can otherwise hang Chinese punctuation outside the text frame.
    // The editor and saved draft continue to use the unchanged original point.
    const capacity = Math.max(1, Math.floor(item.w * 72 / size) - 2);
    const tokens = item.value.match(/[+-]?\d+(?:[,.]\d+)*[%％]?|[A-Za-z]+|[\s\S]/gu) ?? [];
    const lines = [];
    let line = "";
    for (const token of tokens) {
      // Keep ordinary numbers/percentages together; closing punctuation may use the reserved margin.
      const pieces = Array.from(token).length > capacity ? Array.from(token) : [token];
      for (const piece of pieces) {
        if (line && Array.from(line + piece).length > capacity && !/^[，。；：！？、）】]$/.test(piece)) {
          lines.push(line);
          line = "";
        }
        line += piece;
      }
    }
    if (line) lines.push(line);
    return { ...item, size, value: lines.join("\n") };
  });
}

function fittedHeading(field, value, x, y, w, h, preferred, color, bold) {
  for (let size = preferred; size >= 14; size--) {
    const wrapped = wrapDensityText(value, w, size);
    if (wrapped.split("\n").length * size * 1.3 / 72 + 0.04 <= h) return editable(field, wrapped, x, y, w, h, size, color, bold);
  }
  throw new Error("页面标题或副标题无法在可读字号内完整排下，原文未被截断，请调整内容排布。");
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
        fittedHeading("title", slide.title, 0.65, 2.03, 11.98, 2.45, 40, palette.white, true),
        fittedHeading(0, slide.points[0], 0.65, 4.63, 11.98, 1.01, 19, palette.mint),
        rect(0.65, 6.65, 12.03, 0.014, "5A8172"),
        text(page, 0.65, 6.8, 4, 0.36, 12, palette.mint),
        ...pictures
      ]
    };
  }
  const name = Object.hasOwn(sectionLabels, slide.layout) ? slide.layout : "summary";
  let body = metricIsStale(slide) ? ((typeof slide.manualLayout === "string" && (slide.manualLayout.startsWith("density-") || slide.manualLayout === "ai-design") ? manualBody(slide, index, palette) : undefined) ?? (name === "metrics" && !requiresDensity(slide, name, palette) ? fitDisplayText(summaryRows(slide.points, palette)) : narrativeBody(slide, name, palette).map(wrapNarrativeText))) :
    manualBody(slide, index, palette) ?? metricBody(slide, name, palette) ?? narrativeBody(slide, name, palette);
  if (!bodyReadable(body) || !hasEveryPoint(body, slide.points.length)) body = narrativeBody(slide, name, palette);
  if (!hasEveryPoint(body, slide.points.length)) throw new Error("本页布局无法完整保留全部要点，已停止呈现，原文未被删减。");
  return {
    name,
    background: palette.background,
    elements: [
      ...(technical ? [rect(0.36, 0.46, 0.065, 1.79, palette.accent), rect(11.93, 0.55, 0.75, 0.045, palette.accent)] : []),
      text(sectionLabels[name], 0.65, 0.46, 9.75, 0.44, 17, palette.muted, true),
      fittedHeading("title", slide.title, 0.65, 0.96, 12.03, 1.32, 29, palette.heading, true),
      ...body,
      rect(0.65, 6.65, 12.03, 0.014, palette.line),
      text(page, 0.65, 6.8, 4, 0.36, 12, palette.muted),
      ...pictures
    ]
  };
}
