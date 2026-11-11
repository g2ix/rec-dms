import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import PizZip from "pizzip";
import { HIGHLIGHT_END, HIGHLIGHT_START, type RenderImage } from "@/lib/docs/view";

type ImageModuleCtor = new (options: {
  centered?: boolean;
  getImage: (tagValue: string, tagName: string) => Buffer;
  getSize: (img: Buffer, tagValue: string, tagName: string) => [number, number];
}) => unknown;

const ImageCtor = ImageModule as unknown as ImageModuleCtor;

export function fillDocx(template: Buffer, data: Record<string, unknown>, images: RenderImage[]): Buffer {
  const byKey = new Map(images.map((image) => [image.key, image]));
  const zip = new PizZip(template);
  const imageModule = new ImageCtor({
    centered: false,
    getImage(tagValue) {
      const image = byKey.get(tagValue);
      if (!image) throw new Error(`Missing signature image “${tagValue}”.`);
      return image.bytes;
    },
    getSize(_img, tagValue) {
      const image = byKey.get(tagValue);
      return [image?.width ?? 160, image?.height ?? 48];
    },
  });
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    modules: [imageModule as never],
    nullGetter() {
      return "";
    },
  });
  doc.render(data);
  const rendered = doc.getZip();
  for (const name of Object.keys(rendered.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    const xml = rendered.file(name)?.asText();
    if (xml && xml.includes(HIGHLIGHT_START)) rendered.file(name, highlightRuns(xml));
  }
  const out = rendered.generate({ type: "nodebuffer" }) as Buffer;
  return out;
}

/** rPr children that come after w:highlight in the schema order. */
const AFTER_HIGHLIGHT = ["<w:u ", "<w:u/", "<w:effect", "<w:bdr", "<w:shd", "<w:fitText", "<w:vertAlign", "<w:rtl", "<w:cs", "<w:em", "<w:lang", "<w:eastAsianLayout", "<w:specVanish", "<w:oMath"];
const HIGHLIGHT_TAG = `<w:highlight w:val="yellow"/>`;

/** Gives each run that holds a highlight marker a yellow highlight, then removes the markers. */
export function highlightRuns(xml: string): string {
  const marked = xml.replace(/<w:r(?=[\s>])([^>]*)>([\s\S]*?)<\/w:r>/g, (run, attrs: string, body: string) => {
    if (!body.includes(HIGHLIGHT_START) && !body.includes(HIGHLIGHT_END)) return run;
    let next = body;
    const open = next.indexOf("<w:rPr>");
    if (open >= 0) {
      const end = next.indexOf("</w:rPr>");
      const props = next.slice(open + 7, end);
      if (!props.includes("<w:highlight")) {
        const cut = AFTER_HIGHLIGHT.map((tag) => props.indexOf(tag)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
        const placed = cut == null ? `${props}${HIGHLIGHT_TAG}` : `${props.slice(0, cut)}${HIGHLIGHT_TAG}${props.slice(cut)}`;
        next = `${next.slice(0, open + 7)}${placed}${next.slice(end)}`;
      }
    } else {
      next = `<w:rPr>${HIGHLIGHT_TAG}</w:rPr>${next}`;
    }
    return `<w:r${attrs}>${next}</w:r>`;
  });
  return marked.replaceAll(HIGHLIGHT_START, "").replaceAll(HIGHLIGHT_END, "");
}
