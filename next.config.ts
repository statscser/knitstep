// next.config.ts
// bodySizeLimit is placed in both locations for compatibility across Next.js versions:
// - top-level `serverActions` (Next.js 15+)
// - `experimental.serverActions` (Next.js 14 and below)
// The type annotation is omitted intentionally to prevent TypeScript from
// rejecting unknown keys and silently falling back to the 1 MB default.

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.1.159'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
