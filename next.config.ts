import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright and local checks use 127.0.0.1 while Next serves localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
