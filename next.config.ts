import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@neondatabase/serverless", "@upstash/redis", "@vercel/blob"],
};

export default nextConfig;
