import { parseSlideDesign, primaryEvidence } from "./slide-design.js";
import { parseAuxMetrics, parseMetric } from "./metric.js";
import { densityLimits } from "./density.js";

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
export const generationOutputBudget = (pages,hasImages=false) => Math.min(8192,4096+pages*320+(hasImages?512:0));

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
    `标题建议精简到 ${titleLimit} 字左右。第一页是封面，points 必须是恰好包含一个非空字符串的数组，作为副标题。正文页 points 必须是非空字符串数组，按内容语义分点，每条建议 ${pointLimit} 字以内；不要为了满足固定条数合并无关事实。每页聚焦清晰观点，避免文字过密。阶段按实际顺序逐条列出。正文标题写可核对的结论，保留限定条件，避免跨页重复。`,
    "角色分工页按角色分别列点，一条只对应一个角色及其职责；不得为减少条数把不同角色合写。标题声称几类角色，正文就应分别对应，职责仅来自原始资料。",
    "角色职责页标题体现角色/职责/分工，各条写成“角色名：职责”。只有资料明确给出执行顺序时，流程/机制页按“第一步：…”“第二步：…”逐条写；不能把并列机制或问题清单编造为顺序流程。",
    "layout 可用 summary 概览、metrics 指标、progress 进展、risk 风险、actions 行动、decision 待决策。指标页仅在一个要点最能支撑标题时，用 lead 指定其从 0 开始的索引并省略 design。按证据与结论的关联选，不按数字大小。无明确主次时可用 composition:cards 并列。前后对比保留两值和同一单位。",
    '仅输出紧凑 JSON，根对象只有 slides 数组。封面示例 {"title":"阶段汇报","points":["汇报周期与对象"]}。正文示例 {"title":"结论","points":["证据"],"layout":"metrics","lead":0}。数组页数须遵守前述要求。',
    "优先完成全部slides、title、points和layout，不输出推理过程、说明、Markdown或缩进。省略不必要的design/composition等可选设计字段；仅在来源可靠且表达核心关系时附加metric/metrics。核心事实、数字、口径和限定条件必须完整保留在points，不得为节省输出而丢失。",
    "指标页把最支撑标题的主指标单独写成一条要点并用 lead 指向它，其他业务口径另列；单值保留名称和单位，前后对比保留同单位两值，完成率须保留完成量/总量关系，不自行补算。不得把多个不同指标塞进主点。decision 页用 lead 指向标为「当前建议：」的要点，条件另列。保留范围、统计口径、目标与限定条件。",
    '任意正文页都可选一个metric:{kind,point,label,unit,values,rate?,basis?}，没有合适指标就省略，不为画图编造或强行提取数字。layout决定整页叙事，metric仅表达来源要点的数据关系，不能取代更重要的风险、结论或决策；point无需与叙事lead相同。label及values必须原样复制同一要点中的片段，values带同一单位；single一个值，comparison默认[之前,之后]，当前/目标对比须声明basis:"target"并按[当前,目标]排列且来源中明确含“目标”，不得把目标写成之后或计算改善率；completion按[完成量,总量]，原文有完成率时rate复制对应百分比。例：要点“已完成9,600份，计划12,000份，完成率80%”对应{"kind":"completion","point":0,"label":"已完成","unit":"份","values":["9,600份","12,000份"],"rate":"80%"}。无法确认关系就省略，不改写来源。',
    "metric的label保留统计口径且不超过16字；单位限分钟、小时、秒、天、单、件、份、条、人、%、％、倍、元、万元。数值非负，最多6位小数、15位有效数字，不用科学计数法；每个values片段最多32字，须各有独立来源。completion单位不能是百分比或倍，总量必须大于0；rate最多3位小数且与两值计算后的舍入结果一致。",
    "指标页有多个可靠关系时，metric指定与lead一致的主指标，可选metrics数组最多两个辅助指标，沿用metric协议且point互不重复；每个label/values/rate都须复制各自要点原文。辅助指标不抢主视觉，无法确认关系就省略，优先省略design节约输出。不要求每页或每条都有图。",
    "可选 design 为 [[要点索引,元素,x,y,宽,高]]，每条要点各用一次，12×12 整数网格内无重叠。text 文字 4×5，focus 重点 4×5，milestone 阶段 4×6，compare 同单位前后值 6×7（均为最小宽高）。有顺序的阶段适合 milestone，坐标应与原要点顺序一致；两种同等方案可用composition:cards，风险及决策可用composition:spotlight，spotlight不是design元素。坐标排不下时省略design，不合并或删除要点。无需强行提供设计参数。",
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
    maxTokens: generationOutputBudget(pageCount,images.length>0),
    thinking: false
  };
}

export function parseDeck(response, pageCount = defaultPages) {
  if (response?.stopReason === "maxTokens") throw new Error("Anna 的回复达到输出上限，内容被截断。");
  if (response?.stopReason === "contentFilter") throw new Error("Anna 无法生成这份内容。请检查笔记后再试。");
  if (typeof response?.content?.text !== "string") throw new Error("Anna 没有返回可用内容。");
  if (response.content.text.length > densityLimits.rawChars) throw new Error("Anna 返回的内容过大，原始输出已保留供诊断。");
  const raw = response.content.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  if (raw.length > densityLimits.rawChars) throw new Error("Anna 返回的内容过大，原始输出已保留供诊断。");
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
      if (!Array.isArray(slide?.points) || slide.points.length < 1 || (index === 0 && slide.points.length !== 1)) {
        throw new Error(`第 ${index + 1} 页的要点数量有误。`);
      }
      const design = index > 0 && parseSlideDesign(slide.design, slide.points.length);
      const lead = index > 0 ? primaryEvidence({ ...slide, design }) : undefined;
      const points = slide.points.map((point, field) => validateText(point, `要点 ${field + 1}`, index));
      const metric = index > 0 ? parseMetric(slide.metric, points) : undefined;
      const metrics = index > 0 ? parseAuxMetrics(slide.metrics, points, metric) : [];
      return {
        title: validateText(slide?.title, "标题", index),
        points,
        ...(index > 0 && layouts.includes(slide.layout) ? { layout: slide.layout } : {}),
        ...(index > 0 && compositions.includes(slide.composition) ? { composition: slide.composition } : {}),
        ...(lead !== undefined ? { lead } : {}),
        ...(design ? { design } : {}),
        ...(metric ? { metric } : {}),
        ...(metrics.length ? { metrics } : {})
      };
    })
  };
}

function validateText(value, field, index) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`第 ${index + 1} 页的${field}缺少文字或含无效控制字符。`);
  }
  return value.trim();
}
