/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@crypto-gateway/shared'],
  experimental: {
    optimizePackageImports: ['@radix-ui/react-icons'],
  },
};

export default nextConfig;
