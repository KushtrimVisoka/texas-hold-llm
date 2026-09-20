import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // These three ship native addons or .wasm side files that do not survive Next's
  // server bundling — satori's harfbuzz in particular resolves to a bogus /ROOT path.
  // Keeping them external makes them resolve from node_modules at runtime.
  serverExternalPackages: ['better-sqlite3', '@resvg/resvg-js', 'satori', 'harfbuzzjs', 'yoga-wasm-web'],
};

export default nextConfig;
