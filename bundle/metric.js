// One optional main metric, grounded in exact fragments of its original point.
// This validates numeric provenance, not the truth of the model-authored point.
const units = new Set(["分钟", "小时", "秒", "天", "单", "件", "份", "条", "人", "%", "％", "倍", "元", "万元"]);
const numberPattern = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,6})?$/;
const percentAlias = value => value.replaceAll("％", "%");

function sourcedValue(quote, unit, source, used) {
  if (typeof quote !== "string") return undefined;
  quote = percentAlias(quote); unit = percentAlias(unit); source = percentAlias(source);
  if (typeof quote !== "string" || quote.length > 32 || quote !== quote.trim() || !quote.endsWith(unit)) return undefined;
  const token = /^(\p{L}*[：:]?\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,6})?\s*)$/u.exec(quote.slice(0, -unit.length));
  if (!token || /负|negative|minus|约|近|至少|至多|超过|不足|不满|大于|小于|以上|以下|预计|估计|[零〇一二三四五六七八九十百千万亿两]/i.test(token[1] ?? "")) return undefined;
  const prefix = token[1] ?? "";
  const text = token[2].trim();
  if (!numberPattern.test(text)) return undefined;
  const significantDigits = text.replaceAll(",", "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
  if (significantDigits.length > 15) return undefined;
  const value = Number(text.replaceAll(",", ""));
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return undefined;
  let start = source.indexOf(quote);
  while (start >= 0) {
    const end = start + quote.length;
    const numberStart = start + prefix.length;
    const preceding = source.slice(0, numberStart).trimEnd().at(-1);
    if ((!preceding || !/[\d.,+\-−]/.test(preceding)) && !/[/／]/.test(source[end] ?? "") &&
        !used.some(range => start < range.end && range.start < end)) {
      used.push({ start, end });
      return { value, text, quote: quote.slice(prefix.length), start: numberStart, end, precision: text.split(".")[1]?.length ?? 0 };
    }
    start = source.indexOf(quote, start + 1);
  }
  return undefined;
}

export function parseMetric(raw, points) {
  if (raw && typeof raw === "object") {
    raw = { ...raw, unit: typeof raw.unit === "string" ? percentAlias(raw.unit) : raw.unit };
    if (raw.rate === null) delete raw.rate;
    if (typeof raw.rate === "string") raw.rate = percentAlias(raw.rate);
  }
  if (!raw || !["single", "comparison", "completion"].includes(raw.kind) || !Number.isInteger(raw.point) ||
      raw.point < 0 || raw.point >= points.length || !units.has(raw.unit)) return undefined;
  const source = points[raw.point];
  if (typeof source !== "string" || typeof raw.label !== "string" || !raw.label.trim() || raw.label.length > 16 ||
      /[\r\n\u0000-\u001f]/.test(raw.label) || !source.includes(raw.label) ||
      (Object.hasOwn(raw, "sourceText") && raw.sourceText !== source)) return undefined;
  const count = raw.kind === "single" ? 1 : 2;
  if (!Array.isArray(raw.values) || raw.values.length !== count) return undefined;
  const used = [];
  const values = raw.values.map(quote => sourcedValue(quote, raw.unit, source, used));
  if (values.some(value => !value)) return undefined;
  if (Object.hasOwn(raw, "basis") && (raw.kind !== "comparison" || !["target", "before-after"].includes(raw.basis))) return undefined;
  if (raw.basis === "target") {
    const isTarget = value => {
      const before = source.slice(0,value.start).split(/[，,；;。\n（(]/).at(-1).replace(raw.label, "").trim();
      const after = source.slice(value.end);
      return /^(?:阶段|本期|预设|既定|最终|计划|当前)?目标(?:值为|为|是)?[：:\s]*$/.test(before) ||
        (/^目标/.test(after) && /^(?:低于|高于)?(?:预设的?|既定的?)?$/.test(before));
    };
    if (!source.includes("目标") || isTarget(values[0]) || !isTarget(values[1])) return undefined;
  }
  if (raw.kind !== "completion" && Object.hasOwn(raw, "rate")) return undefined;
  if (raw.kind === "completion") {
    if (["%", "％", "倍"].includes(raw.unit) || values[1].value <= 0) return undefined;
    const percentage = values[0].value / values[1].value * 100;
    if (!Number.isFinite(percentage) || percentage > 1e6) return undefined;
    // Any source percentage requires an explicit rate reference, never a guessed association.
    if (/\d\s*[%％]/.test(source) && !Object.hasOwn(raw, "rate")) return undefined;
    if (Object.hasOwn(raw, "rate")) {
      const rateUnit = typeof raw.rate === "string" && /[%％]$/.exec(raw.rate)?.[0];
      const rate = rateUnit && sourcedValue(raw.rate, rateUnit, source, []);
      const scale = rate && 10 ** rate.precision;
      const rounded = rate && Math.round((percentage + Number.EPSILON * Math.max(1, percentage)) * scale) / scale;
      if (!rate || rate.precision > 3 ||
          Math.abs(rounded - rate.value) > 1e-8) return undefined;
    }
  }
  return {
    kind: raw.kind, point: raw.point, label: raw.label, unit: raw.unit, values: values.map(value => value.quote),
    ...(Object.hasOwn(raw, "basis") ? { basis: raw.basis } : {}),
    ...(Object.hasOwn(raw, "rate") ? { rate: raw.rate } : {}), sourceText: source
  };
}

export function metricIsStale(slide) {
  return slide.metricInvalidated === true || Boolean(slide.metric && typeof slide.metric.sourceText === "string" &&
    slide.metric.sourceText !== slide.points?.[slide.metric.point]);
}

export function resolveMetric(slide) {
  if (metricIsStale(slide) || typeof slide.metric?.sourceText !== "string") return undefined;
  const metric = parseMetric(slide.metric, slide.points);
  if (!metric) return undefined;
  const numbers = metric.values.map(quote => Number(quote.slice(0, -metric.unit.length).trim().replaceAll(",", "")));
  return { ...metric, numbers, texts: metric.values.map(quote => quote.slice(0, -metric.unit.length).trim()) };
}

export function invalidateMetricForEdit(slide, field, nextText) {
  if (!Number.isInteger(field) || slide.points[field] === nextText) return false;
  const removed = slide.metrics?.some(metric => metric.point === field);
  if (removed) {
    slide.metrics = slide.metrics.filter(metric => metric.point !== field);
    slide.metricsInvalidated = [...new Set([...(slide.metricsInvalidated ?? []), field])];
  }
  if (slide.metric?.point !== field) return Boolean(removed);
  delete slide.metric;
  slide.metricInvalidated = true;
  slide.manualLayout = "plain";
  return true;
}

export function parseAuxMetrics(raw, points, main) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(main ? [main.point] : []);
  return raw.slice(0, 2).flatMap(item => {
    const metric = parseMetric(item, points);
    if (!metric || seen.has(metric.point)) return [];
    seen.add(metric.point);
    return [metric];
  });
}

export function resolveAuxMetrics(slide) {
  if (metricIsStale(slide)) return [];
  return parseAuxMetrics(slide.metrics, slide.points, slide.metric).flatMap(metric => {
    if (slide.metricsInvalidated?.includes(metric.point)) return [];
    const resolved = resolveMetric({ points: slide.points, metric });
    return resolved ? [resolved] : [];
  });
}

export function formatMetricNumber(number, precision = 1) {
  return number.toLocaleString("zh-CN", { maximumFractionDigits: precision });
}
