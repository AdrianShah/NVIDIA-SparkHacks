/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // mapbox-gl and leaflet are browser-only; prevent SSR bundling errors
      config.externals = [...(config.externals || []), "mapbox-gl", "leaflet"];
    }
    return config;
  },
};

module.exports = nextConfig;
