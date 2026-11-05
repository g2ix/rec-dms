export type Formula =
  | { op: "num"; value: number }
  | { op: "ref"; path: string[] }
  | { op: "sum"; path: string[] }
  | { op: "count"; path: string[] }
  | { op: "add" | "sub" | "mul" | "div"; left: Formula; right: Formula };

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): Formula {
    const expr = this.parseExpr();
    this.skip();
    if (!this.done()) throw new Error(`Unexpected "${this.source.slice(this.index)}" in the formula.`);
    return expr;
  }

  private done(): boolean {
    return this.index >= this.source.length;
  }

  private skip(): void {
    while (this.source[this.index] === " " || this.source[this.index] === "\n" || this.source[this.index] === "\t") {
      this.index += 1;
    }
  }

  private parseExpr(): Formula {
    let left = this.parseTerm();
    for (;;) {
      this.skip();
      const op = this.source[this.index];
      if (op !== "+" && op !== "-") break;
      this.index += 1;
      const right = this.parseTerm();
      left = { op: op === "+" ? "add" : "sub", left, right };
    }
    return left;
  }

  private parseTerm(): Formula {
    let left = this.parseFactor();
    for (;;) {
      this.skip();
      const op = this.source[this.index];
      if (op !== "*" && op !== "/") break;
      this.index += 1;
      const right = this.parseFactor();
      left = { op: op === "*" ? "mul" : "div", left, right };
    }
    return left;
  }

  private parseFactor(): Formula {
    this.skip();
    const char = this.source[this.index];
    if (char === "(") {
      this.index += 1;
      const inner = this.parseExpr();
      this.skip();
      if (this.source[this.index] !== ")") throw new Error("The formula is missing a closing parenthesis.");
      this.index += 1;
      return inner;
    }
    if (char != null && char >= "0" && char <= "9") return { op: "num", value: this.number() };
    const ident = this.ident();
    this.skip();
    if (this.source[this.index] === "(") {
      this.index += 1;
      const path = this.path(this.ident());
      this.skip();
      if (this.source[this.index] !== ")") throw new Error("The formula is missing a closing parenthesis.");
      this.index += 1;
      if (ident !== "sum" && ident !== "count") throw new Error(`Unknown function "${ident}". Use sum or count.`);
      return { op: ident, path };
    }
    return { op: "ref", path: this.path(ident) };
  }

  private number(): number {
    const start = this.index;
    while (this.source[this.index] != null && /[0-9.]/.test(this.source[this.index]!)) this.index += 1;
    const text = this.source.slice(start, this.index);
    if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`"${text}" is not a number.`);
    return Number(text);
  }

  private ident(): string {
    this.skip();
    const start = this.index;
    const first = this.source[this.index];
    if (first == null || !/[A-Za-z_]/.test(first)) throw new Error("The formula is missing a name.");
    this.index += 1;
    while (this.source[this.index] != null && /[A-Za-z0-9_]/.test(this.source[this.index]!)) this.index += 1;
    return this.source.slice(start, this.index);
  }

  private path(first: string): string[] {
    const parts = [first];
    for (;;) {
      if (this.source[this.index] !== ".") break;
      this.index += 1;
      if (this.source[this.index] === "*") {
        this.index += 1;
        parts.push("*");
        continue;
      }
      const start = this.index;
      const char = this.source[this.index];
      if (char == null || !/[A-Za-z_]/.test(char)) throw new Error("The formula is missing a name after the dot.");
      this.index += 1;
      while (this.source[this.index] != null && /[A-Za-z0-9_]/.test(this.source[this.index]!)) this.index += 1;
      parts.push(this.source.slice(start, this.index));
    }
    return parts;
  }
}

export function parseFormula(input: string): Formula {
  return new Parser(input.trim()).parse();
}

function collect(node: unknown, segments: string[]): unknown[] {
  if (segments.length === 0) return node === undefined ? [] : [node];
  const [head, ...rest] = segments;
  if (head === "*") {
    if (!Array.isArray(node)) return [];
    return node.flatMap((item) => collect(item, rest));
  }
  if (node == null || typeof node !== "object" || Array.isArray(node)) return [];
  return collect((node as Record<string, unknown>)[head!], rest);
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function evaluateFormula(formula: Formula, data: Record<string, unknown>): number {
  switch (formula.op) {
    case "num":
      return formula.value;
    case "ref":
      return asNumber(collect(data, formula.path)[0]);
    case "sum":
      return collect(data, formula.path).reduce<number>((total, value) => total + asNumber(value), 0);
    case "count":
      return collect(data, formula.path).length;
    case "add":
      return evaluateFormula(formula.left, data) + evaluateFormula(formula.right, data);
    case "sub":
      return evaluateFormula(formula.left, data) - evaluateFormula(formula.right, data);
    case "mul":
      return evaluateFormula(formula.left, data) * evaluateFormula(formula.right, data);
    case "div": {
      const right = evaluateFormula(formula.right, data);
      if (right === 0) return 0;
      return evaluateFormula(formula.left, data) / right;
    }
    default:
      return 0;
  }
}

export function formulaPaths(formula: Formula): string[][] {
  switch (formula.op) {
    case "ref":
    case "sum":
    case "count":
      return [formula.path];
    case "add":
    case "sub":
    case "mul":
    case "div":
      return [...formulaPaths(formula.left), ...formulaPaths(formula.right)];
    default:
      return [];
  }
}
