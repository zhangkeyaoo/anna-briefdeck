export const supportPilot = {
  notes: "客服工单分流试点处理 480 单，覆盖 2 个业务组。首次响应中位数由 18 分钟降至 11 分钟，人工复核覆盖率保持 100%。夜班样本不足，需要补抽样。是否纳入第 3 个业务组待决策。",
  slides: [
    { title: "客服工单分流试点", points: ["缩短首次响应，保留人工复核"] },
    {
      title: "首次响应缩短 7 分钟", layout: "metrics",
      points: ["首次响应中位数由 18 分钟降至 11 分钟。", "人工复核覆盖率保持 100%。", "试点覆盖 2 个业务组，处理 480 单。"],
      design: [[0, "compare", 0, 0, 8, 12], [1, "focus", 8, 0, 4, 6], [2, "text", 8, 6, 4, 6]]
    },
    {
      title: "夜班效果还需要证据", layout: "risk", points: ["夜班样本不足，需要补抽样。"],
      design: [[0, "focus", 0, 2, 10, 8]]
    },
    {
      title: "第 3 个业务组是否纳入试点", layout: "decision", points: ["是否扩围仍待决定。"],
      design: [[0, "focus", 2, 1, 10, 10]]
    }
  ]
};

export const archiveMigration = {
  notes: "档案迁移计划分三阶段。11 月 23 日冻结清单，11 月 26 日迁移并抽样复核，11 月 30 日核对结果后切换。切换依赖复核完成，若发现差异则延后切换。迁移窗口需要负责人审批。",
  slides: [
    { title: "档案库分阶段迁移", points: ["确认阶段、切换条件和审批"] },
    {
      title: "从冻结清单到正式切换", layout: "actions",
      points: ["11 月 23 日，冻结迁移清单。", "11 月 26 日，迁移并抽样复核。", "11 月 30 日，核对结果后切换。"],
      design: [[0, "milestone", 0, 1, 4, 10], [1, "milestone", 4, 1, 4, 10], [2, "milestone", 8, 1, 4, 10]]
    },
    {
      title: "复核通过才切换", layout: "risk",
      points: ["抽样复核完成后，才进入切换。", "发现差异时延后切换。"],
      design: [[0, "focus", 0, 0, 12, 7], [1, "text", 0, 7, 12, 5]]
    },
    {
      title: "迁移窗口待负责人审批", layout: "decision", points: ["请负责人审批拟定的迁移窗口。"],
      design: [[0, "focus", 1, 2, 10, 8]]
    }
  ]
};
