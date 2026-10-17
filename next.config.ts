import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  reactCompiler: true,
  // The vendored editor ships TypeScript source (packages/platejs-editor).
  transpilePackages: ['@shots/platejs-editor'],
  poweredByHeader: false,
  allowedDevOrigins: process.env.PLATFORM_ALLOWED_DEV_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  experimental: {
    // These packages expose many icons from barrel entry points. Rewriting
    // imports keeps unused icons out of the Webpack production bundle.
    optimizePackageImports: ['@hugeicons/react', 'hugeicons-react'],
  },

  images: {
    remotePatterns: [
      {
        // R2 custom domain (new)
        protocol: 'https',
        hostname: 'assets.screenshot-studio.com',
      },
    ],
  },

  // Enable SharedArrayBuffer for multi-threaded FFmpeg WASM
  // Requires Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy
  // Only applied to editor routes — applying globally breaks YouTube embeds on landing page
  async headers() {
    return [
      // Security and SEO headers for all pages
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      // COOP/COEP for editor routes (FFmpeg WASM)
      {
        source: '/editor/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      {
        source: '/home',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      // Cross-origin isolation lets the background remover run ONNX WASM
      // multi-threaded. credentialless still allows the Hugging Face model fetch.
      {
        source: '/:locale(es|fr|de|ja|pt|ko|zh)?/remove-background',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      // Same isolation as the editor, so the video compressor gets the
      // multi-threaded FFmpeg core instead of the much slower single thread.
      {
        source: '/:locale(es|fr|de|ja|pt|ko|zh)?/compress-video',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      // An isolated page also requires compatible headers on its module worker.
      // The unbundled FFmpeg worker (see lib/export/ffmpeg-encoder.ts) is a
      // module worker too, so it needs the same header.
      {
        source: '/ffmpeg/:path*',
        headers: [{ key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' }],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' }],
      },
    ]
  },

  // Permanent redirects for SEO (301)
  async redirects() {
    return [
      {
        source: '/features/background-remover',
        destination: '/remove-background',
        permanent: true,
      },
      // Old /home editor URL → new / root
      {
        source: '/home',
        destination: '/',
        permanent: true,
      },
      {
        source: '/free-screenshot-editor',
        destination: '/features/screenshot-beautifier',
        permanent: true,
      },
      {
        source: '/:locale(es|fr|de|ja|pt|ko|zh)/free-screenshot-editor',
        destination: '/:locale/features/screenshot-beautifier',
        permanent: true,
      },
      {
        source: '/free-screenshot-editor-online',
        destination: '/features/screenshot-beautifier',
        permanent: true,
      },
      {
        source: '/free-screenshot-studio/:path*',
        destination: '/features/screenshot-beautifier',
        permanent: true,
      },
      {
        source: '/blog/:slug*',
        destination: '/guides/:slug*',
        permanent: true,
      },
    ]
  },

  // Proxy R2 assets through same origin to avoid CORS issues
  // (especially critical for canvas capture during video export)
  // Also proxy PostHog through same origin to bypass ad blockers
  async rewrites() {
    const r2Url = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
    return [
      // LLMs.txt — serve markdown to AI agents
      {
        source: '/llms.txt',
        destination: '/api/llms',
      },
      {
        source: '/llms-full.txt',
        destination: '/api/llms-full',
      },
      {
        source: '/openapi.json',
        destination: '/api/openapi',
      },
      {
        source: '/indexnow-key.txt',
        destination: '/api/indexnow',
      },
      {
        source: '/.well-known/openapi.json',
        destination: '/api/openapi',
      },
      // PostHog reverse proxy — static assets must come first
      {
        source: '/svc/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/svc/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
      // R2 asset proxy
      ...(r2Url
        ? [
            {
              source: '/r2-assets/:path*',
              destination: `${r2Url}/:path*`,
            },
          ]
        : []),
    ]
  },

  // REQUIRED for react-konva
  webpack: (config, { isServer }) => {
    config.externals = [...(config.externals || []), { canvas: 'canvas' }]
    if (!isServer) {
      // The background-removal client must not bundle Node-only inference backends.
      config.resolve.alias = {
        ...config.resolve.alias,
        sharp$: false,
        'onnxruntime-node$': false,
      }
    }
    return config
  },
}

export default withNextIntl(nextConfig)
