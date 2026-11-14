import type { NextConfig } from "next";
import { securityHeaders, storageOriginFromEndpoint } from "./src/lib/security-headers";

const extraOrigins = (process.env.APP_BASE_URL ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    try {
      return new URL(value).host;
    } catch {
      return "";
    }
  })
  .filter(Boolean);

const nextConfig: NextConfig = {
  // The Playwright server builds into its own folder, so it can run beside `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Playwright and local checks use 127.0.0.1 while Next serves localhost.
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  // Server Actions compare the Origin header to the host. allowedOrigins adds
  // hosts that are still this app (the public APP_BASE_URL when it differs).
  experimental: {
    serverActions: {
      allowedOrigins: extraOrigins,
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          storageOrigin: storageOriginFromEndpoint(process.env.S3_ENDPOINT),
          hsts: process.env.VERCEL_ENV === "production",
          devBlobWorkers: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
};

export default nextConfig;
