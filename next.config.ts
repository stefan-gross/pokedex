import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack(config, { isServer }) {
    // onnxruntime-web ist nur im Browser nutzbar — auf dem Server ausblenden
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'onnxruntime-web': false,
      };
    }
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pokemontcg.io',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.scrydex.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'assets.tcgdex.net',
        pathname: '/**',
      },
    ],
    // Bilder werden 30 Tage gecacht (pokemontcg.io Bilder ändern sich nie)
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
