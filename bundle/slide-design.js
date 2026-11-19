export const designGrid = 12;

export function primaryEvidence(slide) {
  if (!["metrics", "decision"].includes(slide.layout)) return undefined;
  if (Object.hasOwn(slide, "lead")) {
    return Number.isInteger(slide.lead) && slide.lead >= 0 && slide.lead < slide.points.length
      ? slide.lead : undefined;
  }
  if (slide.layout === "decision") {
    const recommendations = slide.points.flatMap((point, index) => /^当前建议[：:]/.test(point.trim()) ? [index] : []);
    if (recommendations.length === 1) return recommendations[0];
    return undefined;
  }
  if (slide.design?.some(block => block.kind === "compare" || block.kind === "milestone")) return undefined;
  const focus = (slide.design ?? []).filter(block => block.kind === "focus");
  return focus.length === 1 ? focus[0].point : undefined;
}
const minimumSize = {
  text: [4, 5],
  focus: [4, 5],
  milestone: [4, 6],
  compare: [6, 7]
};

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function parseSlideDesign(design, pointCount) {
  if (!Array.isArray(design) || design.length !== pointCount) return undefined;
  const blocks = [];
  for (const item of design) {
    if (!Array.isArray(item) || item.length !== 6) return undefined;
    const [point, kind, x, y, w, h] = item;
    if (typeof kind !== "string" || !Object.hasOwn(minimumSize, kind)) return undefined;
    if (![point, x, y, w, h].every(Number.isInteger)) return undefined;
    const [minWidth, minHeight] = minimumSize[kind];
    if (point < 0 || point >= pointCount || x < 0 || y < 0 ||
        w < minWidth || h < minHeight || x + w > designGrid || y + h > designGrid) return undefined;
    const block = { point, kind, x, y, w, h };
    if (blocks.some(other => other.point === point || overlaps(other, block))) return undefined;
    blocks.push(block);
  }
  return blocks;
}
