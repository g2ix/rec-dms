import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import PizZip from "pizzip";
import type { RenderImage } from "@/lib/docs/view";

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
  const out = doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
  return out;
}
