import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pokemontcg.io',
        pathname: '/**',
      },
    ],
    // Bilder werden 30 Tage gecacht (pokemontcg.io Bilder ändern sich nie)
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
