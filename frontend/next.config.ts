import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build a self-contained server bundle for the production Docker image.
  output: "standalone",
};

export default nextConfig;
