import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/kosit_validator",
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
