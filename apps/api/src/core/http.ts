import type { Context, Next } from "hono";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function ok<T>(data: T): Response {
  return Response.json({ ok: true, data });
}

export function fail(error: ApiError): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    { status: error.status },
  );
}

export async function errorHandler(error: unknown, context: Context): Promise<Response> {
  if (error instanceof ApiError) return fail(error);
  console.error("Unhandled API error", error);
  return fail(new ApiError(500, "internal_error", "The request could not be completed."));
}

export async function localOnly(context: Context, next: Next): Promise<Response | void> {
  const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const rawHost = context.req.header("host")?.toLowerCase();
  const host = rawHost?.startsWith("[")
    ? rawHost.slice(0, rawHost.indexOf("]") + 1)
    : rawHost?.split(":")[0];
  if (!host || !allowedHosts.has(host)) {
    return fail(new ApiError(403, "forbidden_host", "JobSniper only accepts localhost requests."));
  }

  const origin = context.req.header("origin");
  if (origin) {
    const parsed = new URL(origin);
    const originHost = parsed.hostname.toLowerCase();
    if (!allowedHosts.has(originHost) || parsed.protocol !== "http:") {
      return fail(new ApiError(403, "forbidden_origin", "Cross-origin requests are not accepted."));
    }
    const requestHost = context.req.header("host");
    if (parsed.host.toLowerCase() !== requestHost?.toLowerCase()) {
      return fail(new ApiError(403, "origin_mismatch", "Origin does not match Host."));
    }
  }
  await next();
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "validation_error", "A JSON object is required.");
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ApiError(400, "validation_error", `${field} must be a non-empty string.`, { field });
  }
  return value.trim();
}

export function optionalString(value: unknown, field: string, maxLength = 20_000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ApiError(400, "validation_error", `${field} must be a string.`, { field });
  }
  return value.trim();
}

export function oneOf<T extends string>(value: unknown, field: string, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new ApiError(400, "validation_error", `${field} is invalid.`, { field, values });
  }
  return value as T;
}

export function integer(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, "validation_error", `${field} must be an integer between ${min} and ${max}.`, { field });
  }
  return parsed;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ApiError(400, "validation_error", `${field} must be boolean.`, { field });
  }
  return value;
}
