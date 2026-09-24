import { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/metadata";
import { LAST_UPDATED_ISO } from "@/lib/seo/changelog";
import { getAllComparisonSlugs } from "@/lib/seo/comparisons";
import { guides } from "@/lib/seo/guides";
import { TOOLS, TOOLS_HUB_PATH } from "@/lib/seo/tools";

const STATIC_PATHS = [
  "/",
  "/editor",
  "/free-screenshot-editor",
  "/store-screenshots",
  "/code",
  "/mockup-generator",
  "/remove-background",
  TOOLS_HUB_PATH,

  "/features",
  "/features/screenshot-beautifier",
  "/features/social-media-graphics",
  "/features/animation-maker",
  "/features/3d-effects",
  "/features/browser-mockups",
  "/features/code-snippets",

  "/for",
  "/for/developers",
  "/for/marketers",
  "/for/designers",

  "/compare",
  "/guides",
  "/changelog",

  "/docs",
  "/docs/authentication",
  "/developers",

  "/about",
  "/contact",
  "/privacy-policy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = LAST_UPDATED_ISO;

  const paths = [
    ...STATIC_PATHS,
    ...TOOLS.map((tool) => tool.slug),
    ...getAllComparisonSlugs().map((slug) => `/compare/${slug}`),
    ...guides.map((guide) => `/guides/${guide.slug}`),
  ];

  return paths.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
  }));
}
