/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The shared contracts package is a workspace dependency compiled to CommonJS.
  transpilePackages: ['@cinema/contracts'],
};

export default nextConfig;
