import { Metadata } from "next";
import Link from "next/link";
import { InstagramLogoIcon as InstagramIcon } from "@phosphor-icons/react/dist/ssr/InstagramLogo"
import { LinkedinLogoIcon as Linkedin01Icon } from "@phosphor-icons/react/dist/ssr/LinkedinLogo"
import { XLogoIcon as NewTwitterIcon } from "@phosphor-icons/react/dist/ssr/XLogo"
import { ShareIcon as Share08Icon } from "@phosphor-icons/react/dist/ssr/Share";
import { FeaturePage } from "@/components/features/FeaturePage";
import { PREVIEW_SHADOW, MOTION } from "@/components/tools/ui";
import { PRO_PLAN_OFFER } from "@/lib/seo/json-ld";
import { OG_DEFAULTS, SITE_URL } from "@/lib/seo/metadata";
import { PRODUCT_FACTS } from "@/lib/seo/product-facts";
import { gradientColors } from "@/lib/constants/gradient-colors";

const PAGE_URL = `${SITE_URL}/features/social-media-graphics`;

export const metadata: Metadata = {
  title: "Social Media Graphics Maker",
  description:
    "Create social media graphics for Twitter, LinkedIn, and Instagram. Turn screenshots into shareable posts with perfect dimensions. Included in every Shots plan.",
  keywords: [
    "social media graphics maker",
    "twitter card generator",
    "linkedin post maker",
    "instagram post creator",
    "social media image editor",
    "graphics maker",
    "twitter post image maker",
    "og image generator",
    "social media screenshot tool",
    "product hunt screenshot maker",
    "social media mockup generator",
    "shots.so alternative",
    "pika.style alternative",
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: "Social Media Graphics Maker",
    description:
      "Create social media graphics at the right size for every platform. Included in every Shots plan.",
    url: PAGE_URL,
  },
  alternates: {
    canonical: "/features/social-media-graphics",
  },
};

const capabilities = [
  {
    icon: NewTwitterIcon,
    title: "Twitter / X (1200 x 675)",
    description: "Twitter cards and post images sized for the feed.",
  },
  {
    icon: Linkedin01Icon,
    title: "LinkedIn (1200 x 627)",
    description: "Graphics sized for LinkedIn posts.",
  },
  {
    icon: InstagramIcon,
    title: "Instagram (1080 x 1080)",
    description: "Square posts and stories that stand out in crowded feeds.",
  },
  {
    icon: Share08Icon,
    title: "Any platform, custom size",
    description: `Export at any dimension for blogs, presentations, or documentation, up to ${PRODUCT_FACTS.maxExportScale}x resolution.`,
  },
];

const steps = [
  {
    title: "Add your screenshot",
    description:
      "Drag and drop any image or paste from clipboard. Supports PNG, JPG, and WebP.",
  },
  {
    title: "Pick a platform size",
    description:
      "Choose a Twitter, LinkedIn, or Instagram preset, or set a custom width and height.",
  },
  {
    title: "Style and export",
    description: `Add a background, shadow, and frame, then export up to ${PRODUCT_FACTS.maxExportScale}x resolution with no watermark.`,
  },
];

const faqs = [
  {
    question: "Which plans include the social media graphics maker?",
    answer:
      "Every plan. Every platform preset, background, and export is included in every Shots plan, with no watermark.",
  },
  {
    question: "What sizes are available for Twitter, LinkedIn, and Instagram?",
    answer:
      "Twitter/X cards are 1200x675, LinkedIn posts are 1200x627, and Instagram posts are 1080x1080. A custom size option covers any other platform.",
  },
  {
    question: "Can I use a custom size for a platform that isn't listed?",
    answer:
      "Yes. Set any width and height you need for blogs, presentations, or documentation, then export the same way.",
  },
  {
    question: "Do I need design skills to make a graphic?",
    answer:
      "No. Drop in a screenshot, pick a background and platform size, and export. No design software or experience required.",
  },
  {
    question: "Can I match my brand's colors?",
    answer:
      "Yes. Choose a solid color, gradient, or upload your own background image to match your brand across every graphic.",
  },
];

const relatedLinks = [
  { href: "/features/screenshot-beautifier", label: "Screenshot beautifier" },
  { href: "/features/animation-maker", label: "Animation maker" },
  { href: "/features/3d-effects", label: "3D effects" },
  { href: "/features/code-snippets", label: "Code images" },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": `${PAGE_URL}#software`,
      name: "Shots - Social Media Graphics Maker",
      applicationCategory: "DesignApplication",
      operatingSystem: "Web Browser",
      description:
        "Online tool to create social media graphics for Twitter, LinkedIn, and Instagram from screenshots.",
      offers: PRO_PLAN_OFFER,
      featureList: [
        "Twitter/X card size (1200x675)",
        "LinkedIn post size (1200x627)",
        "Instagram post size (1080x1080)",
        "Custom dimensions for any platform",
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
          name: "Social Media Graphics",
          item: PAGE_URL,
        },
      ],
    },
  ],
};

function SocialPreview() {
  return (
    <div className="flex gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`size-16 rounded-lg bg-neutral-900 transition-transform ${MOTION} group-hover:-translate-y-1 ${PREVIEW_SHADOW}`}
          style={{ transitionDelay: `${i * 60}ms` }}
        >
          <div className="flex h-full flex-col justify-center gap-1.5 p-3">
            <div className="h-1.5 w-8 rounded-full bg-white/30" />
            <div className="h-1.5 w-5 rounded-full bg-white/15" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SocialMediaGraphicsPage() {
  return (
    <FeaturePage
      name="Social Media Graphics"
      title="Social media graphics maker"
      intro="Create graphics for Twitter, LinkedIn, and Instagram. Turn screenshots into shareable content with the right dimensions for every platform, included in every Shots plan."
      ctaHref="/editor"
      ctaLabel="Create Graphics"
      previewGradient={gradientColors.pink_purple_blue}
      preview={<SocialPreview />}
      capabilities={capabilities}
      steps={steps}
      alternativesIntro="Shots.so and Pika Style both make shareable social graphics from screenshots. Shots covers the same platform sizes and backgrounds, with an animation timeline and 3D tilt on top."
      alternativeSlugs={["shots-so", "pika-style"]}
      guideLinks={[
        { href: "/guides/best-free-shots-so-alternatives", label: "Best free Shots.so alternatives" },
      ]}
      faqs={faqs}
      relatedLinks={relatedLinks}
      closing={
        <>
          Compare options in the{" "}
          <Link href="/compare/shots-so" className="text-foreground underline underline-offset-4">
            Shots.so comparison
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
