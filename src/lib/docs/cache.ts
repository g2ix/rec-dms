export function generatedFileWhere(input: {
  status: string;
  revision: number;
  kind: "GENERATED_DOCX" | "GENERATED_PDF";
}): { kind: "GENERATED_DOCX" | "GENERATED_PDF"; sourceRevision?: number } {
  if (input.status === "LOCKED") return { kind: input.kind };
  return { kind: input.kind, sourceRevision: input.revision };
}
