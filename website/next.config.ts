import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits on top of the demo's chat input during presentations.
  devIndicators: false,
  // The game's server-side judge runs the local model with onnxruntime-node's native binding.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
