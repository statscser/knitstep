// next.config.ts
// bodySizeLimit is placed in both locations for compatibility across Next.js versions:
// - top-level `serverActions` (Next.js 15+)
// - `experimental.serverActions` (Next.js 14 and below)
// The type annotation is omitted intentionally to prevent TypeScript from
// rejecting unknown keys and silently falling back to the 1 MB default.

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* 在 Next.js 14.1+ 中，serverActions 是稳定版，
     直接放在一级配置项下即可。
  */
  serverActions: {
    bodySizeLimit: '10mb', 
  },
  // 删掉整个 experimental 块，除非你还有其他实验性功能
};

export default nextConfig;
