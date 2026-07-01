/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  async rewrites() {
    const apiBase = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3001';
    const normalizedApiBase = apiBase.replace(/\/$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${normalizedApiBase}/api/:path*`,
      },
      {
        source: '/ws/:path*',
        destination: `${normalizedApiBase}/ws/:path*`,
      },
      {
        source: '/commands/:uid',
        destination: '/c/:uid/commands',
      },
      {
        source: '/points/:uid',
        destination: '/c/:uid/points',
      },
      {
        source: '/roulettelog/:uid',
        destination: '/c/:uid/roulette/logs',
      },
      {
        source: '/roulettelist/:uid',
        destination: '/c/:uid/roulette',
      },
    ];
  },
};

export default nextConfig;
