import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  partialPrefetching: true,
};

export default nextConfig;
