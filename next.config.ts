import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server (HMR websocket + /_next dev assets) to be reached from
  // the LAN, e.g. a phone at http://10.0.0.194:3000. Next's allowlist matcher
  // rejects a bare "*" and only does per-segment wildcards, so we list the LAN
  // /24 explicitly. Add any Cloudflare-tunnel hostname here too (e.g.
  // "*.trycloudflare.com" or your custom tunnel domain).
  allowedDevOrigins: ["10.0.0.*"],
};

export default nextConfig;
