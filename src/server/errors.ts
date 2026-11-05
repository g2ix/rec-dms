/**
 * Typed application error.
 * TODO: map `code` to a friendly message in the UI when server actions land.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}
