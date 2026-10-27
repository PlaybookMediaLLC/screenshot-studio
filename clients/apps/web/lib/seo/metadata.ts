import type { Metadata } from "next";

export const SITE_URL = "https://shots.playbookmedia.io";

export const OG_IMAGE = {
  url: `${SITE_URL}/og.jpg`,
  width: 1200,
  height: 630,
  alt: "Shots - Launch what you shipped.",
};

export const OG_DEFAULTS = {
  type: "website",
  locale: "en_US",
  siteName: "Shots",
  images: [OG_IMAGE],
} satisfies Metadata["openGraph"];
