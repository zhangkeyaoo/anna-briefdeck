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

export function inspectSlideDesign(design, pointCount) {
  const fail=(code,message,element)=>({error:{code,message,element}});
  if (!Array.isArray(design) || design.length !== pointCount) return fail("POINT_COUNT",`design必须恰好包含${pointCount}个元素，每条要点一次`);
  const blocks = [];
  for (const [element,item] of design.entries()) {
    if (!Array.isArray(item) || item.length !== 6) return fail("TUPLE",`第${element+1}个元素必须为6项数组`,element);
    const [point, kind, x, y, w, h] = item;
    if (typeof kind !== "string" || !Object.hasOwn(minimumSize, kind)) return fail("KIND",`第${element+1}个元素类型不受支持`,element);
    if (![point, x, y, w, h].every(Number.isInteger)) return fail("INTEGER",`第${element+1}个元素的索引及坐标尺寸必须是整数`,element);
    const [minWidth, minHeight] = minimumSize[kind];
    if(point<0||point>=pointCount)return fail("POINT_INDEX",`第${element+1}个元素要点索引${point}超出范围`,element);
    if(x<0||y<0)return fail("ORIGIN",`第${element+1}个元素x/y不可为负`,element);
    if(w<minWidth)return fail("MIN_WIDTH",`第${element+1}个元素(point=${point},${kind})宽度${w}小于最小${minWidth}`,element);
    if(h<minHeight)return fail("MIN_HEIGHT",`第${element+1}个元素(point=${point},${kind})高度${h}小于最小${minHeight}`,element);
    if(x+w>designGrid||y+h>designGrid)return fail("BOUNDS",`第${element+1}个元素x+w=${x+w},y+h=${y+h}，边界必须<=${designGrid}`,element);
    const block = { point, kind, x, y, w, h };
    if(blocks.some(other=>other.point===point))return fail("DUPLICATE",`第${element+1}个元素重复要点${point}`,element);
    const collision=blocks.findIndex(other=>overlaps(other,block));
    if(collision>=0)return fail("OVERLAP",`第${element+1}个元素与第${collision+1}个元素重叠`,element);
    blocks.push(block);
  }
  return {blocks};
}

export function parseSlideDesign(design,pointCount) {
  return inspectSlideDesign(design,pointCount).blocks;
}
