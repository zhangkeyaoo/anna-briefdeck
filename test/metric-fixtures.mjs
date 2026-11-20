import { readFileSync } from "node:fs";

const real = JSON.parse(readFileSync(new URL("./fixtures/p1-real-response.json", import.meta.url)));
const migration = JSON.parse(readFileSync(new URL("./fixtures/p12-migration-excerpt.json", import.meta.url)));

// All metric annotations are synthetic. The customer text is the saved real response;
// migration text is a confirmed real excerpt, not a recovered model JSON response.
export function metricExamples() {
  const customer = JSON.parse(real.content.text);
  customer.slides[1].lead = 0;
  customer.slides[1].metric = { kind: "comparison", point: 0, label: "首次响应时间中位数", unit: "分钟", values: ["18分钟", "11分钟"] };
  const retrieval = structuredClone(customer);
  retrieval.slides[1] = { title: migration.title, points: migration.points, layout: "metrics", lead: 0,
    metric: { kind: "comparison", point: 0, label: "平均检索时间", unit: "分钟", values: ["8分钟", "2分钟"] } };
  const completion = structuredClone(retrieval);
  completion.slides[1].metric = { kind: "completion", point: 0, label: "迁移", unit: "份", values: ["9,600份", "12,000份"], rate: "80%" };
  return [{ name: "customer", raw: customer }, { name: "retrieval", raw: retrieval }, { name: "completion", raw: completion }];
}

export function edgeMetricDeck(point, metric) {
  const raw = metricExamples()[0].raw;
  raw.slides[1] = { layout: "metrics", title: "结构化指标边界验证", points: [point], lead: 0, metric };
  return raw;
}

export function metricBoundaryDeck() {
  const fill = text => (text + "本期仅覆盖两个业务组，统计范围需要持续复核。".repeat(4)).slice(0, 56);
  const examples = metricExamples();
  return { slides: [structuredClone(examples[0].raw.slides[0]), ...examples.map(({ raw }) => {
    const slide = structuredClone(raw.slides[1]);
    slide.points = slide.points.map(fill);
    slide.points.push(fill("下一阶段仍需核对适用范围和统计口径。"));
    return slide;
  })] };
}

// Cross-page fixtures: all structured annotations and non-customer prose are explicit simulations.
export function crossPageExamples() {
  const progress = metricExamples()[2].raw;
  progress.slides[1].layout = "progress";
  delete progress.slides[1].lead;
  const risk = edgeMetricDeck("复杂工单分类仍不稳定，暂不全面推广。", undefined);
  risk.slides[1] = { layout: "risk", title: "准确率未达目标，扩大试点仍需验证", points: [
    "复杂工单分类仍不稳定，暂不全面推广。", "准确率92%，目标95%，差距3个百分点。"
  ], metric: { kind: "comparison", point: 1, label: "准确率", unit: "%", values: ["92%", "95%"], basis: "target" } };
  const decision = structuredClone(risk);
  decision.slides[1] = { layout: "decision", lead: 1, title: "先验证效果，再决定是否扩大范围", points: [
    "首次响应中位数由18分钟降至11分钟，扩围前仍需验证。", "当前建议：先验证效果，再决定是否扩大范围。"
  ], metric: { kind: "comparison", point: 0, label: "首次响应中位数", unit: "分钟", values: ["18分钟", "11分钟"] } };
  const summary = structuredClone(risk);
  summary.slides[1] = { layout: "summary", composition: "cards", title: "覆盖保持稳定，后续效果仍需验证", points: [
    "人工复核覆盖率100%，统计范围为当前两个业务组。", "后续仍需核对样本与适用范围。"
  ], metric: { kind: "single", point: 0, label: "人工复核覆盖率", unit: "%", values: ["100%"] } };
  const ordinary = structuredClone(risk);
  ordinary.slides[1] = { layout: "summary", title: "先完成复核，再提交决策", points: ["先完成材料复核。", "决策安排待负责人确认。"] };
  const ordinal = structuredClone(risk);
  ordinal.slides[1] = { layout: "progress", title: "阶段安排待核对", points: ["第1天完成接入，第2天完成验收。"],
    design: [[0, "milestone", 0, 0, 12, 12]], metric: { kind: "comparison", point: 0, label: "完成", unit: "天", values: ["1天", "2天"] } };
  return [{ name: "progress", raw: progress }, { name: "risk", raw: risk }, { name: "decision", raw: decision },
    { name: "summary", raw: summary }, { name: "ordinary", raw: ordinary }, { name: "ordinal", raw: ordinal }];
}
