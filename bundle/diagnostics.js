import { slideLayout } from "./layout.js";
import { relationshipPlan } from "./relationships.js";
import { metricIsStale, parseMetric, resolveAuxMetrics, resolveMetric } from "./metric.js";

export function renderingDiagnostics(deck, style = {}) {
  let raw;
  try { raw = JSON.parse(deck.generationTrace?.rawText?.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1")); } catch { /* Older drafts need no migration. */ }
  return {
    source: raw ? "有原始模型回执；返回字段与实际呈现分开核对，生成成功不代表新组件已采用" : "历史/示例稿无原始模型回执，只能确认当前内容与渲染，不能认定模型选用了新协议",
    generation: deck.generationTrace ? { model: deck.generationTrace.model, usage: deck.generationTrace.usage, quotaConsumed: deck.generationTrace.quotaConsumed, credits:deck.generationTrace.credits, attempts:deck.generationTrace.attempts, recordedAt: deck.generationTrace.recordedAt } : undefined,
    pages: deck.slides.map((slide, index) => {
      try {
      const elements = slideLayout(slide, index, deck.slides.length, style).elements;
      const relation = relationshipPlan(slide);
      const model = raw?.slides?.[index];
      const metric = resolveMetric(slide);
      const applied = [...new Set(elements.filter(item => item.component).map(item => item.component))];
      const rawMetrics = model?.metrics ?? slide.metrics;
      const auxiliaries = Array.isArray(rawMetrics) ? rawMetrics.slice(0, 2).map(item => {
        const parsed = parseMetric(item, slide.points);
        const rendered = elements.some(element => element.metricPoint === item?.point && element.component?.startsWith("metric-aux:"));
        return { point: item?.point, kind: item?.kind, valid: Boolean(parsed), applied: rendered,
          reason: rendered ? "辅助关系已实际呈现" : !parsed ? "来源片段、标签、单位或比例校验未通过，保留原文" : slide.metricsInvalidated?.includes(item.point) ? "来源编辑后失效，不恢复旧关系" : metricIsStale(slide) ? "主指标来源已修改，停用旧组合图" : !resolveAuxMetrics(slide).some(metric => metric.point === item.point) ? "重复来源或未保留有效辅助指标" : "主叙事/P2选择或局部空间不兼容，保留原文" };
      }) : [];
      return {
        page: index + 1, title: slide.title, pointCount: slide.points.length,
        modelReturned: model ? { layout: model.layout, lead: model.lead, metric: model.metric, metrics: model.metrics, design: model.design } : "未保存原始返回",
        manualLayout: slide.manualLayout ?? "自动",
        singlePageRedesign: slide.redesignTrace ? { confirmed:true,model:slide.redesignTrace.model,usage:slide.redesignTrace.usage,
          quotaConsumed:slide.redesignTrace.quotaConsumed,recordedAt:slide.redesignTrace.recordedAt,rawDesign:slide.redesignTrace.rawText,
          attempts:slide.redesignTrace.attempts,credits:slide.redesignTrace.credits,
          customGrid:slide.redesignTrace.customGrid,applied:applied.includes("ai-redesign")||Boolean(slide.manualLayout) } : undefined,
        appliedComponents: applied.length ? applied : [index ? "原有文字/设计布局" : "封面"],
        relationship: { detected: relation.id ?? relation.detected ?? null, applied: applied.includes(relation.id), reason: relation.reason },
        mainMetric: { present: Boolean(model?.metric ?? slide.metric), valid: Boolean(metric), applied: elements.some(item => item.component === "metric-main" || item.metricPart), reason: !metric ? "缺失/非法/来源已修改；不猜测指标" : "主指标是否采用以applied及实际组件为准" },
        auxiliaries, ignoredAuxiliaryCount: Array.isArray(rawMetrics) ? Math.max(0, rawMetrics.length - 2) : 0,
        removedAfterEdit: slide.metricsInvalidated ?? []
      };
      } catch (error) { return { page: index + 1, title: slide.title, renderError: error.message }; }
    })
  };
}
