import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ts-expect-error - Next.js config type might not include eslint in this version
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.yandexcloud.net",
        pathname: "/acp-assets/**",
      },
    ],
  },
};

export default nextConfig;
