/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static file serving from public folder
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'replicate.delivery',
      },
      {
        protocol: 'https', 
        hostname: '*.replicate.delivery',
      },
    ],
  },
  // API timeout for video generation (can take a while)
  serverRuntimeConfig: {
    apiTimeout: 300000, // 5 minutes
  },
};

module.exports = nextConfig;


