import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This standalone app can sit inside a folder with another package-lock.json.
  turbopack: { root: __dirname },
};

export default nextConfig;
