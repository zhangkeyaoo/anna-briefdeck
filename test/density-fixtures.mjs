// Explicitly synthetic boundary fixtures, not additional Anna responses.
import { sampleDeck } from "../bundle/deck.js";
export function densityDeck() {
  const layouts = ["summary", "metrics", "risk", "progress", "decision", "actions"];
  return { slides: [structuredClone(sampleDeck.slides[0]), ...layouts.map((layout, index) => ({
    title: `${index + 1}条要点完整性与长中文边界`, layout,
    points: Array.from({ length: index + 1 }, (_, field) => {
      const prefix = `第${field + 1}项：`;
      const prose = "由人力资源部门与直属主管共同确认实施范围及责任归属，保留统计周期和业务限定条件，尚未实施验证，需要后续评估并记录反馈。";
      return prefix + Array.from(prose).slice(0, 56 - prefix.length).join("");
    })
  }))] };
}
export function shortDensityDeck(count = 8) {
  const raw = structuredClone(sampleDeck);
  raw.slides[1] = { title: "更多短要点不受六条上限限制", layout: "summary", points: Array.from({ length: count }, (_, i) => `事项${i + 1}：待负责人复核。`) };
  return raw;
}
