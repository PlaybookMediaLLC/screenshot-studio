import { Metadata } from "next";
import Link from "next/link";
import { PaletteIcon as ColorsIcon } from "@phosphor-icons/react/dist/ssr/Palette"
import { DownloadIcon as Download04Icon } from "@phosphor-icons/react/dist/ssr/Download"
import { StackIcon as Layers01Icon } from "@phosphor-icons/react/dist/ssr/Stack"
import { MagicWandIcon as MagicWand01Icon } from "@phosphor-icons/react/dist/ssr/MagicWand";
import { FeaturePage } from "@/components/features/FeaturePage";
import { PREVIEW_SHADOW, MOTION, WindowDots } from "@/components/tools/ui";
import { PRO_PLAN_OFFER } from "@/lib/seo/json-ld";
import { OG_DEFAULTS, SITE_URL } from "@/lib/seo/metadata";
import { PRODUCT_FACTS, atLeast } from "@/lib/seo/product-facts";
import { gradientColors } from "@/lib/constants/gradient-colors";

const PAGE_URL = `${SITE_URL}/features/screenshot-beautifier`;

export const metadata: Metadata = {
  title: "Screenshot Beautifier Online",
  description:
    "Screenshot beautifier: add gradient backgrounds, browser frames, shadows, rounded corners, and padding to turn plain screenshots into mockups. Included in every Shots plan.",
  keywords: [
    "screenshot beautifier",
    "screenshot editor online",
    "beautify screenshots",
    "screenshot editor",
    "screenshot mockup",
    "screenshot background",
    "screenshot shadows",
    "online screenshot beautifier",
    "shots.so alternative",
    "pika.style alternative",
    "screely alternative",
    "xnapper alternative",
    "cleanshot x alternative",
    "snagit alternative",
    "mac window mockup screenshot",
    "browser frame screenshot tool",
    "gradient background screenshot maker",
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: "Screenshot Beautifier - Make Screenshots Look Professional",
    description:
      "Add backgrounds, shadows, and frames to plain screenshots and export in high resolution. Included in every Shots plan.",
    url: PAGE_URL,
  },
  alternates: {
    canonical: "/features/screenshot-beautifier",
  },
};

const capabilities = [
  {
    icon: ColorsIcon,
    title: `${atLeast(PRODUCT_FACTS.backgrounds)} gradient backgrounds`,
    description:
      "Choose from gradients, mesh, solid colors, or upload your own custom background.",
  },
  {
    icon: MagicWand01Icon,
    title: "Shadows",
    description:
      "Add realistic shadows with customizable blur, spread, and opacity for depth.",
  },
  {
    icon: Layers01Icon,
    title: "Rounded corners & padding",
    description:
      "Adjust corner radius and padding to match any style or platform requirement.",
  },
  {
    icon: Download04Icon,
    title: "High-res export",
    description: `Export PNG or JPG at up to ${PRODUCT_FACTS.maxExportScale}x resolution. Perfect for retina displays and print.`,
  },
];

const steps = [
  {
    title: "Upload your screenshot",
    description:
      "Drag and drop any image or paste from clipboard. Supports PNG, JPG, and WebP.",
  },
  {
    title: "Choose your style",
    description: `Pick from ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds, then adjust shadows, corners, and padding to match your brand.`,
  },
  {
    title: "Export & share",
    description: `Download in PNG or JPG, scaled up to ${PRODUCT_FACTS.maxExportScale}x for crisp, high-res output.`,
  },
];

const faqs = [
  {
    question: "Which plans include the screenshot beautifier?",
    answer:
      "Every plan. Every background, shadow, frame, and export option on this page is included in every Shots plan, with no watermark or export limit.",
  },
  {
    question: "What image formats can I upload and export?",
    answer:
      "Upload PNG, JPG, or WebP. Export as PNG or JPG, scaled up to 5x for retina-quality output.",
  },
  {
    question: "Does the beautifier add browser or device frames?",
    answer:
      "Yes. You can wrap your screenshot in a browser window or device frame from the same editor, then adjust the background, shadow, and padding together.",
  },
  {
    question: "Can I use this for social media graphics?",
    answer:
      "Yes. Beautified screenshots export at any resolution, so you can size them for Twitter/X, LinkedIn, Instagram, or any other platform.",
  },
  {
    question: "Do I need to create an account?",
    answer:
      "Yes. Sign up, create a workspace, and subscribe to a plan to use the editor and tools. Your screenshot is edited in the browser and is only uploaded if you save it to your workspace.",
  },
];

const relatedLinks = [
  { href: "/features/browser-mockups", label: "Browser mockups" },
  { href: "/features/social-media-graphics", label: "Social media graphics" },
  { href: "/features/animation-maker", label: "Animation maker" },
  { href: "/features/3d-effects", label: "3D effects" },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": `${PAGE_URL}#software`,
      name: "Shots - Screenshot Beautifier",
      applicationCategory: "DesignApplication",
      operatingSystem: "Web Browser",
      description:
        "Online tool to beautify screenshots with backgrounds, shadows, frames, and padding.",
      offers: PRO_PLAN_OFFER,
      featureList: [
        `${atLeast(PRODUCT_FACTS.backgrounds)} gradient backgrounds`,
        "Custom shadows",
        "Rounded corners and padding",
        "Browser and device frames",
        `Export up to ${PRODUCT_FACTS.maxExportScale}x resolution`,
        "Included in every Shots plan",
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${PAGE_URL}#faq`,
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${PAGE_URL}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        {
          "@type": "ListItem",
          position: 2,
          name: "Features",
          item: `${SITE_URL}/features`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Screenshot Beautifier",
          item: PAGE_URL,
        },
      ],
    },
  ],
};

function BeautifierPreview() {
  return (
    <div
      className={`w-64 overflow-hidden rounded-lg bg-neutral-900 transition-transform ${MOTION} group-hover:-translate-y-1 ${PREVIEW_SHADOW}`}
    >
      <div className="flex items-center gap-1.5 bg-neutral-800 px-3 py-2">
        <WindowDots />
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="h-2.5 w-20 rounded-full bg-white/25" />
        <div className="h-2 w-32 rounded-full bg-white/10" />
        <div className="mt-1 h-16 rounded-md bg-white/10" />
      </div>
    </div>
  );
}

export default function ScreenshotBeautifierPage() {
  return (
    <FeaturePage
      name="Screenshot Beautifier"
      title="Screenshot beautifier"
      intro="Turn plain screenshots into finished visuals. Add backgrounds, shadows, frames, and export in high resolution, included in every Shots plan."
      ctaHref="/editor"
      ctaLabel="Beautify Your Screenshot"
      previewGradient={gradientColors.vibrant_orange_pink}
      preview={<BeautifierPreview />}
      capabilities={capabilities}
      steps={steps}
      alternativesIntro="Shots covers the same backgrounds, shadows, and frames as these beautifier tools, and adds an animation timeline and 3D tilt on every plan."
      alternativeSlugs={[
        "shots-so",
        "pika-style",
        "screely",
        "xnapper",
        "cleanshot-x",
        "snagit",
      ]}
      guideLinks={[
        { href: "/guides/best-free-shots-so-alternatives", label: "Best free Shots.so alternatives" },
        {
          href: "/guides/best-free-screenshot-editors-no-watermark",
          label: "Best free screenshot editors with no watermark",
        },
      ]}
      faqs={faqs}
      relatedLinks={relatedLinks}
      closing={
        <>
          See how it stacks up in the{" "}
          <Link href="/compare/shots-so" className="text-foreground underline underline-offset-4">
            full Shots.so comparison
          </Link>
          , try the{" "}
          <Link href="/editor" className="text-foreground underline underline-offset-4">
            editor
          </Link>
          , or browse{" "}
          <Link href="/tools" className="text-foreground underline underline-offset-4">
            every image tool
          </Link>
          .
        </>
      }
      jsonLd={jsonLd}
    />
  );
}
