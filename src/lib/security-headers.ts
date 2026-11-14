export type Header = { key: string; value: string };

export function securityHeaders(options: {
  storageOrigin: string;
  hsts: boolean;
  /** The Turbopack dev server starts web workers (Monaco's) from blob: URLs. A production build serves them from 'self'. */
  devBlobWorkers?: boolean;
}): Header[] {
  const storage = options.storageOrigin.replace(/\/$/, "");
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    options.devBlobWorkers ? "worker-src 'self' blob:" : "worker-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${storage} https://*.supabase.co`,
    `connect-src 'self' ${storage} https://*.supabase.co`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  const headers: Header[] = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ];
  if (options.hsts) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }
  return headers;
}

export function storageOriginFromEndpoint(endpoint: string | undefined): string {
  if (!endpoint) return "https://*.supabase.co";
  try {
    return new URL(endpoint).origin;
  } catch {
    return "https://*.supabase.co";
  }
}
