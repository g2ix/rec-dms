export function asDataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return {};
}

export function getPath(data: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setPath(data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split(".").filter(Boolean);
  const root = structuredClone(data);
  if (parts.length === 0) return root;
  let current: Record<string, unknown> = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const existing = current[key];
    if (existing == null || typeof existing !== "object" || Array.isArray(existing)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value as never;
  return root;
}
