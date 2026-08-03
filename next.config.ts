import type { NextConfig } from 'next';

// Build-Kennung: Commit-SHA (Vercel) + Build-Zeitpunkt. Wird ins Client-Bundle
// eingebacken; /api/version liefert die Laufzeit-SHA zum Vergleich („neue
// Version verfügbar", wenn die gecachte PWA älter ist als der aktuelle Deploy).
const BUILD_SHA = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev';
const BUILD_TIME = new Date().toISOString();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: BUILD_SHA,
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
  },
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
      {
        // Selbst gehostete Bilder (Backfill für Karten ohne TCGdex-Bild)
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/**',
      },
    ],
    // Bilder werden 30 Tage gecacht (pokemontcg.io Bilder ändern sich nie)
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
