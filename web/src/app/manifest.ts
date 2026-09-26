import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ArcGift",
    short_name: "ArcGift",
    description: "Send USDC like a gift. One link, multiple people, USDC for everyone.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f1fa",
    theme_color: "#f3f1fa",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
