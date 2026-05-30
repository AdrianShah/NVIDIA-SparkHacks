/** @type {import('next').NextConfig} */
const nextConfig = {
  // mapbox-gl uses browser globals; handled via dynamic import with ssr:false
  // No extra webpack config needed for Next.js 14
};

module.exports = nextConfig;
