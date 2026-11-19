export const dimensions = { width: 13.333333, height: 7.5 };
export const fontFace = "Microsoft YaHei";

const palette = {
  forest: "16362E", mint: "B9E5AC", paper: "F6F8F2",
  white: "FFFFFF", muted: "35554C", ink: "182D28", pale: "E4EFE5", line: "D4E2D6"
};

function rect(x, y, w, h, color) {
  return { kind: "rect", x, y, w, h, color };
}

function text(value, x, y, w, h, size, color, bold = false) {
  return { kind: "text", value, x, y, w, h, size, color, bold };
}

export function slideLayout(slide, index, total) {
  const page = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  if (index === 0) {
    return {
      background: palette.forest,
      elements: [
        rect(0.65, 0.56, 0.47, 0.08, palette.mint),
        text("项目进展汇报", 0.65, 0.78, 8, 0.4, 18, palette.mint, true),
        text(slide.title, 0.65, 2.03, 11.98, 2.45, 40, palette.white, true),
        text(slide.points[0], 0.65, 4.63, 11.98, 1.01, 19, palette.mint),
        rect(0.65, 6.65, 12.03, 0.014, "5A8172"),
        text(page, 0.65, 6.8, 4, 0.36, 12, palette.mint)
      ]
    };
  }
  const cards = slide.points.flatMap((point, i) => {
    const y = 2.46 + i * 1.22;
    return [
      rect(0.65, y, 12.03, 1.08, i % 2 ? palette.paper : palette.pale),
      rect(0.65, y, 0.052, 1.08, palette.muted),
      text(point, 0.94, y + 0.06, 11.38, 0.96, 20, palette.ink)
    ];
  });
  return {
    background: palette.white,
    elements: [
      text("项目进展汇报", 0.65, 0.46, 9.75, 0.44, 17, palette.muted, true),
      text(slide.title, 0.65, 0.96, 12.03, 1.32, 29, palette.forest, true),
      ...cards,
      rect(0.65, 6.65, 12.03, 0.014, palette.line),
      text(page, 0.65, 6.8, 4, 0.36, 12, palette.muted)
    ]
  };
}
