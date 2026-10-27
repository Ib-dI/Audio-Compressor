import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything runs in the browser (FFmpeg.wasm), so the site ships as plain static files
  output: "export",
  // The default image optimizer needs a server; static export serves images as-is
  images: { unoptimized: true },
};

export default nextConfig;
