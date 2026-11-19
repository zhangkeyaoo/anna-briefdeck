import { dimensions, fontFace, slideLayout } from "./layout.js";

export function createPresentation(deck, PptxGenJS) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "BriefDeck", ...dimensions });
  pptx.layout = "BriefDeck";
  pptx.title = deck.slides[0].title;
  pptx.author = "BriefDeck";
  for (const [index, slideData] of deck.slides.entries()) {
    const slide = pptx.addSlide();
    const layout = slideLayout(slideData, index, deck.slides.length);
    slide.background = { color: layout.background };
    for (const { kind, value, x, y, w, h, size, color, bold } of layout.elements) {
      if (kind === "rect") {
        slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color }, line: { transparency: 100 } });
      } else {
        slide.addText(value, {
          x, y, w, h, fontFace, fontSize: size, color, bold, margin: 0,
          valign: "mid", wrap: true, lang: "zh-CN"
        });
      }
    }
  }
  return pptx;
}

export function fileName(title) {
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim();
  return `${safe || "项目进展汇报"}-BriefDeck.pptx`;
}
