import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // z3-solver loads its wasm build from node_modules at runtime
  serverExternalPackages: ["z3-solver"],
};

export default nextConfig;
