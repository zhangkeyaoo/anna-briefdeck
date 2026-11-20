// Synthetic boundary data; these are not Anna responses or business facts.
import { sampleDeck } from "../bundle/deck.js";
import { layoutOptions, withLayoutChoice } from "../bundle/layout.js";

const bounded = text => (text + "仅限本期统计范围，后续仍需核对，不能外推到全部业务。".repeat(3)).slice(0, 56);

export const boundaryMetrics = {
  layout: "metrics", lead: 1, title: "长文边界回归：数据口径与范围必须完整",
  points: [bounded("本周处理480单，"), bounded("首次响应由18分钟降至11分钟，"), bounded("人工复核覆盖率100%，")]
};
export const boundarySummary = {
  layout: "summary", title: "长文边界回归：用户切换布局后仍保留全文",
  points: [bounded("当前阶段证据支持继续复核，"), bounded("结论仅适用于目前两个业务组，"), bounded("是否扩大范围需负责人进一步决策，")]
};

export function boundaryLayoutDeck() {
  const variants = [boundaryMetrics, boundarySummary].flatMap(slide => layoutOptions(slide, 1).map(option => ({ slide, choice: option.id })));
  return { slides: [structuredClone(sampleDeck.slides[0]), ...variants.map(({slide, choice}, i) => withLayoutChoice(slide, i + 1, variants.length + 1, choice))] };
}
