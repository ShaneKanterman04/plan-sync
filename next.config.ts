import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Reachable behind a Cloudflare tunnel and on the LAN during dev.
  allowedDevOrigins: ["*"],
};

export default nextConfig;
