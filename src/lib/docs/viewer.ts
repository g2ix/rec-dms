/** How a file should render inside the in-app document viewer. */
export type ViewerKind = "pdf" | "image" | "download";

export function viewerKindFor(mime: string, fileName = ""): ViewerKind {
  const type = mime.toLowerCase();
  const name = fileName.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return "image";
  return "download";
}

/** Refresh signed URLs before the five-minute expiry. */
export const SIGNED_URL_REFRESH_MS = 4 * 60 * 1000;
