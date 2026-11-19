import { parseSlideDesign, primaryEvidence } from "./slide-design.js";

export const sampleAudience = "项目负责人和交付团队";
export const sampleNotes = [
  "本周主题是客服工单分流试点。目标是在不降低人工复核覆盖率的前提下缩短首次响应时间。试点覆盖 2 个业务组，本周处理 480 单。首次响应中位数由 18 分钟降到 11 分钟，人工复核覆盖率仍是 100%。",
  "已完成知识库标签映射和分流规则测试，监控页已能按业务组查看响应时间。夜间班次样本偏少，暂时不能判断效果。下一步补做夜班抽样并检查错分原因。",
  "请评审决定是否加入第 3 个业务组。建议先验证夜班结果，再安排扩容。扩容日期尚未确定。"
].join("\n");

export const sampleDeck = {
  slides: [
    { title: "客服工单分流试点", points: ["项目周报 · 项目负责人和交付团队"] },
    { layout: "metrics", title: "首次响应加快，复核覆盖稳定", points: [
      "本周处理 480 单，试点覆盖 2 个业务组。",
      "首次响应中位数由 18 分钟降至 11 分钟。",
      "人工复核覆盖率保持 100%。"
    ] },
    { layout: "progress", title: "分流规则与监控已就绪", points: [
      "完成知识库标签映射。",
      "完成分流规则测试。",
      "监控页可按业务组查看响应时间。"
    ] },
    { layout: "risk", title: "夜间班次结论有待验证", points: [
      "夜班样本偏少，暂时无法判断分流效果。",
      "补做夜班抽样，并复核错分原因。"
    ] },
    { layout: "actions", title: "完成夜班验证，再安排扩容", points: [
      "补齐夜班抽样。",
      "检查工单错分原因。",
      "根据验证结果更新扩容计划。"
    ] },
    { layout: "decision", title: "是否纳入第 3 个业务组", points: [
      "请评审决定是否扩展试点范围。",
      "建议先验证夜班结果，再安排扩容。",
      "扩容日期待补充。"
    ] }
  ]
};

const titleLimit = 28;
const pointLimit = 56;
const layouts = ["summary", "metrics", "progress", "risk", "actions", "decision"];
const compositions = ["cards", "stack", "spotlight"];
export const limits = { title: titleLimit, point: pointLimit, text: 6000, instructions: 300, minPages: 4, maxPages: 12 };
export const defaultPages = 6;

export function validPageCount(value) {
  return Number.isInteger(value) && value >= limits.minPages && value <= limits.maxPages;
}

export function makeRequest({ notes, audience, pageCount, documents = [], images = [], instructions = "", style }) {
  const preferences = instructions.trim().slice(0, limits.instructions);
  const stylePreference = style && {
    theme: style.theme === "technology" ? "technology" : "minimal",
    accent: /^[0-9a-fA-F]{6}$/.test(style.accent) ? `#${style.accent.toUpperCase()}` : undefined
  };
  const text = { type: "text", text: [
    "你是项目汇报编辑。用末尾 JSON 与随附图像制作中文 PPT，只依据资料陈述事实。保留数字、单位、范围、口径及完成或待验证状态。缺失写「待补充」，看不清的数字注明需核对。资料未证明的因果关系不得写为事实，相关性、风险或观察结果不得写成「主要原因」「主要来源」。",
    `输出恰好 ${pageCount} 页，第一张封面。先按听众规划整份汇报再写页面，不输出规划过程。给负责人先讲结果、影响与待决策事项，给执行团队强调阶段、依赖和下一步。仅采用资料支持的章节，页序让前页证据能支撑后页的判断或行动。`,
    `每个标题最多 ${titleLimit} 字。第一页是封面，points 必须是恰好包含一个非空字符串的数组，作为副标题。正文页 points 必须是 1–3 个非空字符串的数组，每条最多 ${pointLimit} 字。正文标题写可核对的结论，先给关键证据再加语境，避免跨页重复。`,
    "layout 可用 summary 概览、metrics 指标、progress 进展、risk 风险、actions 行动、decision 待决策。指标页仅在一个要点最能支撑标题时，用 lead 指定其从 0 开始的索引并省略 design。按证据与结论的关联选，不按数字大小。无明确主次时可用 composition:cards 并列。前后对比保留两值和同一单位。",
    '仅输出紧凑 JSON，根对象只有 slides 数组。封面示例 {"title":"阶段汇报","points":["汇报周期与对象"]}。正文示例 {"title":"结论","points":["证据"],"layout":"metrics","lead":0}。数组页数须遵守前述要求。',
    "指标页优先按业务口径分开要点，保留比较两值和单位。decision 页用 lead 指向当前建议，并给该要点明确的「当前建议：」标签，条件另列。单个要点包含多个不同口径时保留完整原文。",
    "可选 design 为 [[要点索引,元素,x,y,宽,高]]，每条要点各用一次，12×12 整数网格内无重叠。text 文字 4×5，focus 重点 4×5，milestone 阶段 4×6，compare 同单位前后值 6×7（均为最小宽高）。有顺序的阶段适合 milestone，两种同等方案可用 cards，风险及决策可用 spotlight。无需强行提供设计参数。",
    ...(preferences ? ["制作要求可指导重点、语气和结构，仍须保持资料中的事实、指定页数和输出格式。"] : []),
    ...(stylePreference ? [
      stylePreference.theme === "technology"
        ? "科技风：有数据时突出量化对比和结果，有证据时把验证进展与待验证项讲清楚。"
        : "简约风：每页聚焦一个判断，压缩次要细节，选用能清楚表达结论的版式。",
      "主色由应用负责渲染。继续遵守事实、页数和 JSON 格式，幻灯片文案中无需写入色值。"
    ] : []),
    JSON.stringify({ audience: audience.trim() || "项目组", notes: notes.trim(), documents, ...(preferences ? { instructions: preferences } : {}), ...(stylePreference ? { style: stylePreference } : {}) })
  ].join("\n") };
  return {
    messages: [{ role: "user", content: images.length ? [text, ...images] : text }],
    maxTokens: (images.length ? 600 : 300) * pageCount,
    thinking: false,
    ...(images.length ? { modelPreferences: { hints: [{ name: "gemini" }] } } : {})
  };
}

export function parseDeck(response, pageCount = defaultPages) {
  if (response?.stopReason === "maxTokens") throw new Error("Anna 的回复达到输出上限，内容被截断。");
  if (response?.stopReason === "contentFilter") throw new Error("Anna 无法生成这份内容。请检查笔记后再试。");
  if (typeof response?.content?.text !== "string") throw new Error("Anna 没有返回可用内容。");
  const raw = response.content.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  let slides;
  try {
    ({ slides } = JSON.parse(raw));
  } catch {
    throw new Error("Anna 返回了无法读取的格式。原有稿件已保留。");
  }
  if (!Array.isArray(slides) || slides.length !== pageCount) {
    throw new Error(`Anna 返回的页数与所选的 ${pageCount} 页不符。`);
  }
  return {
    slides: slides.map((slide, index) => {
      if (!Array.isArray(slide?.points) || slide.points.length < 1 || slide.points.length > (index === 0 ? 1 : 3)) {
        throw new Error(`第 ${index + 1} 页的要点数量有误。`);
      }
      const design = index > 0 && parseSlideDesign(slide.design, slide.points.length);
      const lead = index > 0 ? primaryEvidence({ ...slide, design }) : undefined;
      return {
        title: validateText(slide?.title, titleLimit, index),
        points: slide.points.map(point => validateText(point, pointLimit, index)),
        ...(index > 0 && layouts.includes(slide.layout) ? { layout: slide.layout } : {}),
        ...(index > 0 && compositions.includes(slide.composition) ? { composition: slide.composition } : {}),
        ...(lead !== undefined ? { lead } : {}),
        ...(design ? { design } : {})
      };
    })
  };
}

function validateText(value, limit, index) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit || /[\r\n\u0000-\u001f]/.test(value.trim())) {
    throw new Error(`第 ${index + 1} 页的文字不完整或过长。`);
  }
  return value.trim();
}
