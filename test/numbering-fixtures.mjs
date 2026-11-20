import { sampleDeck } from "../bundle/deck.js";
// Page six transcribed from the user's screenshot; other pages are simulated.
export function knowledgeReviewNumberingDeck() {
  const raw = structuredClone(sampleDeck);
  raw.slides[5] = {
    title: "当前建议暂不发布，待定评审节点", layout: "decision", lead: 0,
    points: [
      "当前建议：暂不立即正式发布。优先处理3个高优先级问题，完成权限回归和第二轮验收后，再决定是否上线。",
      "待管理层决策：是否同意以11月27日作为上线评审节点，并根据剩余问题和验收结果决定发布时间。",
      "上线前必须完成五项检查：搜索结果准确性、文档权限、数据更新、性能与稳定性、使用体验。",
      "当前状态：处于上线前验收阶段，尚未正式发布。"
    ]
  };
  return raw;
}
