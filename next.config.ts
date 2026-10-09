import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits on top of the demo's chat input during presentations.
  devIndicators: false,
  // `curl -fsSL https://complier.dev/install | sh`
  async rewrites() {
    return [{ source: "/install", destination: "/install.sh" }];
  },
};

export default nextConfig;
