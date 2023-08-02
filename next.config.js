/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

module.exports = async (phase, { defaultConfig }) => {
  let internalHost = null;
  if (!isProd) {
    const { internalIpV4 } = await import('internal-ip');
    internalHost = await internalIpV4();
  }
  /**
   * @type {import('next').NextConfig}
   */
  const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    output: 'export',
    // Note: This experimental feature is required to use NextJS Image in SSG mode.
    // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
    images: {
      unoptimized: true,
    },
    assetPrefix: isProd ? null : `http://${internalHost}:3000`,
  };
  return nextConfig;
};
