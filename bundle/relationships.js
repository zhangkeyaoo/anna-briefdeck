import { wrapDensityText } from "./density.js";

const ordinals = "一二三四五六七八九十";
const stepPattern = /^(第([一二三四五六七八九十]|\d+)(?:步|阶段|环节)[：:、，,.．\s]*)(.+)$/;
const explicitSupplement = point => /^(?:补充说明|补充要求|备注|说明)[：:]/.test(point) ||
  (/并列/.test(point) && /不存在先后依赖|无先后依赖|不分先后/.test(point));
const text = (value, x, y, w, h, size, color, bold = false) => ({ kind: "text", value, x, y, w, h, size, color, bold });
const rect = (x, y, w, h, color) => ({ kind: "rect", x, y, w, h, color });

// Source syntax and page topic must both agree. No role names, dates or dependencies are inferred.
export function relationshipEvidence(slide) {
  if (!Array.isArray(slide.points) || !slide.points.length) return { reason: "没有正文" };
  if (!["summary", "progress", "actions", undefined].includes(slide.layout)) return { reason: "保留指标、风险或决策主叙事" };
  if (/(角色|分工|职责)/.test(slide.title)) {
    const rows = slide.points.map(point => /^([^：:\n]{1,16}[：:])([\s\S]+)$/.exec(point));
    if (rows.every(Boolean) && new Set(rows.map(row => row[1])).size === rows.length &&
        rows.every(row => !/[；;][^；;：:]{1,16}[：:]/.test(row[2]))) {
      return { id: "relation-roles", label: "角色职责", rows, reason: "主题与逐条角色：职责结构均明确" };
    }
    return { reason: "角色标记缺失、重名或一条混合多个角色，保留原文" };
  }
  if (/(流程|顺序|步骤|阶段|机制|按序)/.test(slide.title)) {
    const rows = slide.points.map(point => stepPattern.exec(point));
    const stepCount = rows.findIndex(row => !row) < 0 ? rows.length : rows.findIndex(row => !row);
    if (stepCount > 1 && rows.slice(0,stepCount).every((row, i) =>
      (Number(row[2]) || ordinals.indexOf(row[2]) + 1) === i + 1 &&
      row[1].match(/步|阶段|环节/)[0] === rows[0][1].match(/步|阶段|环节/)[0]) &&
      rows.slice(stepCount).every((row,i)=>!row && explicitSupplement(slide.points[stepCount+i]))) {
      return { id: "relation-sequence", label: "顺序流程", stepCount,
        rows: rows.map((row,i) => row ? [row[0], row[1], row[3]] : [slide.points[i], "", slide.points[i]]),
        reason: "原文明确连续步骤；独立补充保留但不接入流程" };
    }
    return { reason: "没有从第一步开始的明确连续步骤，不推断流程依赖" };
  }
  return { reason: "没有明确的角色或流程主题，保留普通清单" };
}

export function relationshipPlan(slide) {
  const evidence = relationshipEvidence(slide);
  if (!evidence.id) return evidence;
  const gap = 0.04;
  const height = (4.07 - gap * (evidence.rows.length - 1)) / evidence.rows.length;
  for (const size of [20, 18, 16, 14]) {
    const cells = evidence.rows.map((row, field) => {
      const isRole = evidence.id === "relation-roles";
      const isSupplement = !isRole && field >= evidence.stepCount;
      const label = wrapDensityText(row[1], 2.2, size);
      const body = wrapDensityText(row[2], isSupplement ? 11.65 : 8.4, size);
      const h = height - 0.1;
      if (Math.max(label.split("\n").length, body.split("\n").length) * size * 1.3 / 72 + 0.02 > h) return undefined;
      return { field, label, body, size, y: 2.42 + field * (height + gap), h, height, isRole, isSupplement };
    });
    if (cells.every(Boolean)) return { ...evidence, cells };
  }
  return { reason: `${evidence.label}结构明确，但可读空间不足，保留原布局`, detected: evidence.id };
}

export function renderRelationship(plan, palette) {
  return plan.cells.flatMap(cell => {
    const { field, label, body, y, h, height, size, isRole, isSupplement } = cell;
    if (isSupplement) return [
      rect(0.65,y,12.03,0.014,palette.line),
      { ...text(body,0.84,y+0.05,11.65,h,size,palette.ink), field, component:"relation-supplement", sourcePrefix:"" }
    ];
    const center = y + height / 2;
    return [
      ...(isRole ? [rect(0.65, y, 2.98, height, palette.pale), rect(3.84, y + height, 8.84, 0.01, palette.line)] : [
        ...(field < (plan.stepCount ?? plan.cells.length) - 1 ? [rect(0.885, center, 0.026, height + 0.04, palette.line)] : []),
        rect(0.84, center - 0.06, 0.12, 0.12, palette.accent)
      ]),
      ...(isRole ? [{ ...text(String(field + 1).padStart(2, "0"), 0.72, center - 0.14, 0.36, 0.28, 12, palette.muted, true), pointNumber: field }] : []),
      text(label, 1.23, y + 0.05, 2.2, h, size, palette.heading, true),
      { ...text(body, 4.04, y + 0.05, 8.4, h, size, palette.ink), field, sourcePrefix: plan.rows[field][1] }
    ].map(item => ({ ...item, component: plan.id }));
  });
}
