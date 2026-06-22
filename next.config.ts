import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Turbopack is default in Next.js 16; it reads tsconfig paths natively.
  // @lib/* alias is defined in tsconfig.json — no webpack config needed.
  turbopack: {},
}

export default nextConfig
