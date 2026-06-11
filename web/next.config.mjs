const desktopExport = process.env.NEXT_OUTPUT === "export";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(desktopExport
    ? {
        output: "export",
        pageExtensions: ["tsx", "jsx"],
        trailingSlash: true,
        images: {
          unoptimized: true
        }
      }
    : {})
};

export default nextConfig;
