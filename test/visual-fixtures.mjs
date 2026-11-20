import { sampleDeck } from "../bundle/deck.js";

export function visualDeck() {
  const deck = structuredClone(sampleDeck);
  // Real user-provided knowledge-search prose, reorganized into a simulated combined page.
  // All metric annotations are simulated, not a recovered Anna selection.
  deck.slides[1] = { title: "响应时间缩短，准确率仍未达到目标", layout: "metrics", lead: 0,
    points: ["搜索响应时间中位数由原方案4.5秒下降到1.8秒（同为秒单位）",
      "执行120条搜索测试用例，108条达到预期，测试通过率90%（108/120条）",
      "搜索结果准确率86%，低于预设的90%目标，尚未达标"],
    metric: { kind: "comparison", point: 0, label: "响应时间中位数", unit: "秒", values: ["4.5秒", "1.8秒"] },
    metrics: [
      { kind: "completion", point: 1, label: "搜索测试用例", unit: "条", values: ["108条", "120条"], rate: "90%" },
      { kind: "comparison", point: 2, label: "搜索结果准确率", unit: "%", values: ["86%", "90%"], basis: "target" }
    ] };
  // Cross-department original output was not supplied: these are explicitly synthetic boundaries.
  deck.slides[2] = { title: "四项机制按明确步骤执行", layout: "progress", points: [
    "第一步：需求发起方说明范围、目标和验收标准，待各参与部门确认。",
    "第二步：参与部门核对资源与职责，记录尚待解决的分歧。",
    "第三步：责任人跟进执行情况，按已确认的范围反馈问题。",
    "第四步：参与部门共同复核结果，保留反馈记录，不推断实际效果。"
  ] };
  deck.slides[3] = { title: "五类角色各自承担明确职责", layout: "summary", points: [
    "需求发起方：说明需求范围和预期结果，保留未确认事项并提出验收标准。",
    "项目负责人：协调资源与执行安排，记录尚待决策的问题并跟进责任归属。",
    "参与部门：核对本部门资源与任务，及时反馈执行中遇到的问题和限制。",
    "执行人员：按已确认的范围完成任务，发现职责不清时主动请求确认。",
    "评审人员：依据明确的验收标准复核结果，不能将未经验证的效果写成事实。"
  ] };
  deck.slides[4] = { title: "六项协作问题仍需逐项核对", layout: "summary", points: [
    "职责边界尚未确认，相关事项仍需由各参与部门复核。",
    "需求描述缺少统一口径，当前不能确认各部门理解一致。",
    "执行安排尚待资源核对，不能据此承诺完成时间。",
    "信息反馈渠道不够明确，待责任人确认沟通方式。",
    "结果验收标准尚未对齐，尚不能认定任务已完成。",
    "问题记录需要持续维护，避免遗漏限制条件和待决策事项。"
  ] };
  return deck;
}

export function visualBoundaryDeck() {
  const raw = visualDeck();
  raw.slides[3].title = "六类角色长文完整性边界";
  raw.slides[3].points = Array.from({length:6},(_,i)=>`角色${i+1}：`+"核".repeat(51));
  raw.slides[2].title = "六步流程长文完整性边界";
  raw.slides[2].points = Array.from({length:6},(_,i)=>`第${"一二三四五六"[i]}步：`+"核".repeat(51));
  return raw;
}
