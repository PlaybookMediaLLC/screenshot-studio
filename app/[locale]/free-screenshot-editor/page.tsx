import { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight01Icon,
  BlurIcon,
  ColorsIcon,
  CubeIcon,
  Download04Icon,
  Layers01Icon,
  MagicWand01Icon,
  Video01Icon,
} from "hugeicons-react";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import { CARD_CLASS, INTER } from "@/components/tools/ui";
import { CLAIMS_CHECKED_LABEL, getComparison } from "@/lib/seo/comparisons";
import { OG_DEFAULTS } from "@/lib/seo/metadata";
import { PRODUCT_FACTS, atLeast } from "@/lib/seo/product-facts";

export const metadata: Metadata = {
  title: "Free Screenshot Editor Online",
  description:
    "Free online screenshot editor: blur private details, add arrows and text, then add backgrounds, device mockups, and 3D. Works in any browser. No signup, no watermark.",
  keywords: [
    "screenshot editor online free",
    "free screenshot editor",
    "online screenshot editor",
    "screenshot beautifier free",
    "edit screenshots online",
    "free screenshot tool",
    "screenshot background editor",
    "beautify screenshots online free",
    "screenshot editor no signup",
    "free image editor for screenshots",
    "pika style alternative free",
    "shots.so alternative free",
    "screely alternative",
    "xnapper alternative",
    "cleanshot x alternative",
    "snagit alternative",
    "screenshot mockup generator free",
    "browser mockup tool online",
    "screenshot wrapper no watermark",
    "best screenshot editor online",
    "screenshot editor without watermark",
    "screenshot editor online free without watermark",
    "screenshot editor no download",
    "uizard screenshot editor alternative",
    "add gradient background to screenshot",
    "screenshot shadow and border editor",
    "blur screenshot online",
    "annotate screenshot online free",
    "redact screenshot online",
    "sharex alternative",
    "greenshot alternative",
    "flameshot alternative",
    "screenshot editor for chromebook",
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: "Free Screenshot Editor Online - Screenshot Studio",
    description:
      `Beautify screenshots instantly with ${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds, 3D effects, and animations. Free, no signup required.`,
    url: "/free-screenshot-editor",
  },
  alternates: {
    canonical: "/free-screenshot-editor",
  },
};

const ctaClassName =
  "relative inline-flex items-center justify-center rounded-md border-0 bg-[var(--nav-cta-bg)] px-6 py-2.5 text-base font-medium text-[var(--nav-cta-fg)] shadow-none transition-[transform,box-shadow] duration-150 ease-out [text-shadow:var(--nav-cta-text-shadow)] hover:shadow-[var(--nav-cta-hover-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.97]";

const secondaryCtaClassName =
  "inline-flex items-center justify-center rounded-md px-6 py-2.5 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground active:scale-[0.99]";

const cardSurface = CARD_CLASS;

const ALTERNATIVE_SLUGS = ["shots-so", "pika-style", "screely", "xnapper", "cleanshot-x", "snagit"];

const capabilities = [
  {
    icon: BlurIcon,
    title: "Blur, Annotate & Text",
    description:
      `Blur emails, names, and API keys, draw arrows, lines, rectangles, and circles, and add captions with ${atLeast(PRODUCT_FACTS.fonts)} fonts.`,
  },
  {
    icon: ColorsIcon,
    title: `${atLeast(PRODUCT_FACTS.backgrounds)} Backgrounds`,
    description:
      "Gradients, solid colors, mesh backgrounds, and custom uploads. Make any screenshot pop with a professional backdrop.",
  },
  {
    icon: MagicWand01Icon,
    title: "Shadows & Effects",
    description:
      "Realistic drop shadows with customizable blur, spread, offset, and color. Add depth in one click.",
  },
  {
    icon: Layers01Icon,
    title: "Device Mockups & Frames",
    description:
      "Put screenshots in iPhone, MacBook, and Apple Watch mockups, or Safari, Chrome, macOS, Windows, and Arc frames.",
  },
  {
    icon: CubeIcon,
    title: "3D Perspective",
    description:
      "Tilt, rotate, and scale with real-time 3D transforms. Create eye-catching angles for presentations.",
  },
  {
    icon: Video01Icon,
    title: "Animation & Video Export",
    description:
      `Add keyframe animations with ${atLeast(PRODUCT_FACTS.animationPresets)} presets and export as MP4, WebM, or GIF. Bring static screenshots to life.`,
  },
  {
    icon: Download04Icon,
    title: "High-Res Export",
    description:
      "Export PNG, JPEG, or WebP at up to 5x resolution. Retina-ready images for any platform.",
  },
] as const;

const howItWorks = [
  {
    step: "1",
    title: "Upload Your Screenshot",
    desc: "Drag and drop any image or paste from clipboard. Supports PNG, JPG, WebP, and more.",
  },
  {
    step: "2",
    title: "Style It",
    desc: "Choose a background, add shadows, apply 3D transforms, or pick a one-click preset.",
  },
  {
    step: "3",
    title: "Export & Share",
    desc: "Download as high-res PNG/JPG or export animations as MP4, WebM, or GIF.",
  },
];

const useCases = [
  {
    title: "SaaS Product Marketing",
    description:
      "Turn raw product screenshots into polished hero images for landing pages, pitch decks, and ad creatives.",
  },
  {
    title: "Social Media Posts",
    description:
      "Create scroll-stopping Twitter, LinkedIn, and Instagram posts from app screenshots in seconds.",
  },
  {
    title: "Developer Portfolios",
    description:
      "Showcase your projects with professional screenshots that highlight your best work.",
  },
  {
    title: "Documentation & Tutorials",
    description:
      "Annotate and beautify screenshots for help docs, blog posts, and step-by-step guides.",
  },
  {
    title: "App Store Listings",
    description:
      "Generate beautiful preview images that increase downloads and conversion rates.",
  },
  {
    title: "Client Presentations",
    description:
      "Impress clients with polished mockups instead of raw screenshots in proposals and reports.",
  },
];

const faqs = [
  {
    q: "Is this screenshot editor really free?",
    a: "Yes, Screenshot Studio is 100% free with no hidden costs, premium tiers, or watermarks. Every feature is available to everyone. Unlimited exports, full resolution, no restrictions.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. Screenshot Studio runs entirely in your browser. There is nothing to download or install. Just open the editor and start editing your screenshots immediately.",
  },
  {
    q: "Do I need to create an account?",
    a: "No signup required. Your privacy matters. We don't collect personal data or require registration. Just open the editor and start creating.",
  },
  {
    q: "What image formats are supported?",
    a: "You can upload PNG, JPG, WebP, and most common image formats. Export as high-resolution PNG (with transparency), JPEG, or WebP. For animations, export as MP4, WebM, or GIF.",
  },
  {
    q: "Can I blur or redact sensitive information in a screenshot?",
    a: "Yes. Pick Blur in the Annotate panel and drag over emails, API keys, or names. The blur is part of the exported image. For anything truly secret, crop the area out instead, since a light blur on short text can sometimes be guessed.",
  },
  {
    q: "Is this a good ShareX, Greenshot, or Flameshot alternative?",
    a: "For editing, yes. For capturing, no. Screenshot Studio has no capture button, so take the screenshot with your OS shortcut (Cmd+Shift+4 on macOS, Win+Shift+S on Windows) or a capture tool, then paste it in. You get blur, arrows, shapes, and text like those tools, plus backgrounds, device mockups, 3D, and animation, in any browser with nothing to install.",
  },
  {
    q: "Does it work on Linux and Chromebook?",
    a: "Yes. It runs in any modern browser, including Chrome on ChromeOS and Chrome or Firefox on Linux. Nothing is installed, so it also works on work laptops where you cannot install software.",
  },
  {
    q: "Can I use this for commercial projects?",
    a: "Absolutely. There are no usage restrictions on images you create. Use them for SaaS marketing, social media, client work, app stores, or any other purpose.",
  },
  {
    q: "How does it compare to Canva or Figma?",
    a: "Screenshot Studio is purpose-built for screenshot beautification. Unlike general-purpose editors, it offers one-click presets, 3D perspective transforms, animation timelines, and video export, all optimized for the screenshot-to-social-media workflow.",
  },
];

const desktopTools = [
  {
    name: "Screenshot Studio",
    platforms: "Any browser: Mac, Windows, Linux, ChromeOS",
    install: "None",
    capture: "No (use your OS shortcut)",
    markup: "Blur, arrows, lines, shapes, text",
    mockups: "Yes: iPhone, MacBook, Apple Watch, browsers",
    price: "Free, open source (Apache 2.0)",
  },
  {
    name: "ShareX",
    platforms: "Windows",
    install: "Desktop app",
    capture: "Yes, incl. scrolling capture and recording",
    markup: "Arrows, shapes, text, blur, pixelate, step numbers",
    mockups: "No",
    price: "Free, open source (GPL-3.0)",
  },
  {
    name: "Greenshot",
    platforms: "Windows (free), macOS ($1.99)",
    install: "Desktop app",
    capture: "Yes",
    markup: "Annotate, highlight, obfuscate",
    mockups: "No",
    price: "Free on Windows, open source",
  },
  {
    name: "Flameshot",
    platforms: "Windows, macOS, Linux",
    install: "Desktop app",
    capture: "Yes, region capture",
    markup: "Pencil, arrows, shapes, text, blur, pixelate",
    mockups: "No",
    price: "Free, open source (GPL-3.0)",
  },
];

const featureLinks = [
  {
    href: "/mockup-generator",
    label: "Mockup Generator",
  },
  {
    href: "/guides/best-free-screenshot-editors-no-watermark",
    label: "Best Free Editors, No Watermark",
  },
  {
    href: "/features/screenshot-beautifier",
    label: "Screenshot Beautifier",
  },
  {
    href: "/features/animation-maker",
    label: "Animation Maker",
  },
  {
    href: "/features/3d-effects",
    label: "3D Effects",
  },
  {
    href: "/features/social-media-graphics",
    label: "Social Media Graphics",
  },
] as const;

export default function FreeScreenshotEditorPage() {
  const alternatives = ALTERNATIVE_SLUGS.map((slug) => getComparison(slug)).filter(
    (entry): entry is NonNullable<typeof entry> => Boolean(entry),
  );

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://www.screenshot-studio.com",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Free Screenshot Editor",
            item: "https://www.screenshot-studio.com/free-screenshot-editor",
          },
        ],
      },
      {
        "@type": "SoftwareApplication",
        name: "Screenshot Studio - Free Screenshot Editor Online",
        description:
          "Free screenshot editor online. Beautify screenshots with backgrounds, shadows, 3D effects, animations, and video export. No signup required.",
        url: "https://www.screenshot-studio.com/free-screenshot-editor",
        applicationCategory: "DesignApplication",
        applicationSubCategory: "Screenshot Editor",
        operatingSystem: "Any (Web Browser)",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: [
          `${atLeast(PRODUCT_FACTS.backgrounds)} gradient backgrounds`,
          "Custom shadow effects",
          "3D perspective transforms",
          "Blur and annotation tools (arrows, lines, shapes)",
          "iPhone, MacBook, and Apple Watch mockups",
          "Browser and window frames (Safari, Chrome, macOS, Windows, Arc)",
          "Text and image overlays",
          `${atLeast(PRODUCT_FACTS.animationPresets)} animation presets`,
          "Video export (MP4, WebM, GIF)",
          "High-res export up to 5x",
          "No signup required",
          "No watermarks",
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.a,
          },
        })),
      },
    ],
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Navigation />

      <main className="flex-1">
        <section className="px-6 pb-20 pt-32">
          <div className="mx-auto max-w-4xl text-center">
            <span className="mb-6 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>100% Free</span>
              <span className="h-3 w-px bg-border" aria-hidden />
              <span>No Signup</span>
              <span className="h-3 w-px bg-border" aria-hidden />
              <span>No Watermarks</span>
            </span>
            <h1
              className="mb-6 text-4xl font-semibold tracking-[-0.03em] text-foreground md:text-6xl"
              style={{ fontFamily: INTER }}
            >
              Free Screenshot Editor Online
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground md:text-xl">
              Blur private details, draw arrows and boxes, then add
              backgrounds, device mockups, shadows, and 3D effects and export
              as an image or video. It runs in your browser on Mac, Windows,
              Linux, and Chromebook, with no signup, no download, and no
              watermark.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/editor" className={ctaClassName}>
                Open Free Editor
              </Link>
              <Link href="/features" className={secondaryCtaClassName}>
                See All Features
              </Link>
            </div>
          </div>
        </section>

        <section className="border-y border-border px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-16 text-center">
              <h2
                className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
                style={{ fontFamily: INTER }}
              >
                Everything You Need to Edit Screenshots
              </h2>
              <p className="mx-auto max-w-2xl text-muted-foreground">
                A complete screenshot editor that runs in your browser. No
                bloated software, no learning curve. Just powerful tools that
                work.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((cap, index) => (
                <div
                  key={cap.title}
                  className={`flex gap-4 p-6 ${cardSurface} ${
                    index === capabilities.length - 1
                      ? "md:col-span-2 md:max-w-md md:justify-self-center lg:col-span-1 lg:col-start-2 lg:max-w-none lg:justify-self-stretch"
                      : ""
                  }`}
                >
                  <cap.icon
                    className="size-6 shrink-0 text-foreground"
                    aria-hidden
                  />
                  <div>
                    <h3 className="mb-2 text-base font-semibold text-foreground">
                      {cap.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{cap.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <div className="mb-16 text-center">
              <h2
                className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
                style={{ fontFamily: INTER }}
              >
                3 Steps to Professional Screenshots
              </h2>
              <p className="text-muted-foreground">
                No learning curve. No tutorials needed.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {howItWorks.map((item) => (
                <div key={item.step} className="text-center">
                  <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-md bg-primary text-base font-semibold text-primary-foreground">
                    {item.step}
                  </div>
                  <h3 className="mb-2 text-base font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-16 text-center">
              <h2
                className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
                style={{ fontFamily: INTER }}
              >
                Built for Every Use Case
              </h2>
              <p className="mx-auto max-w-2xl text-muted-foreground">
                Whether you are a developer, marketer, designer, or content
                creator, Screenshot Studio has you covered.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {useCases.map((uc) => (
                <div key={uc.title} className={`p-6 ${cardSurface}`}>
                  <h3 className="mb-2 font-semibold text-foreground">{uc.title}</h3>
                  <p className="text-sm text-muted-foreground">{uc.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 text-center">
              <h2
                className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
                style={{ fontFamily: INTER }}
              >
                Screenshot Studio vs ShareX, Greenshot, and Flameshot
              </h2>
              <p className="mx-auto max-w-3xl text-muted-foreground">
                ShareX, Greenshot, and Flameshot are desktop capture tools: they
                take the screenshot and let you mark it up. Screenshot Studio
                starts after the capture. It runs in any browser with nothing to
                install, so it works on a Chromebook or a locked-down work
                laptop, and it adds backgrounds, device mockups, 3D, and
                animation. Many people use both: capture with ShareX or
                Flameshot, then finish here.
              </p>
            </div>
            <div className={`overflow-x-auto ${cardSurface}`}>
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-border text-foreground">
                  <tr>
                    <th className="p-4 font-semibold">Tool</th>
                    <th className="p-4 font-semibold">Runs on</th>
                    <th className="p-4 font-semibold">Install</th>
                    <th className="p-4 font-semibold">Screen capture</th>
                    <th className="p-4 font-semibold">Blur and markup</th>
                    <th className="p-4 font-semibold">Device mockups</th>
                    <th className="p-4 font-semibold">Price and license</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {desktopTools.map((tool) => (
                    <tr key={tool.name} className="border-b border-border last:border-b-0">
                      <th scope="row" className="p-4 font-semibold text-foreground">
                        {tool.name}
                      </th>
                      <td className="p-4">{tool.platforms}</td>
                      <td className="p-4">{tool.install}</td>
                      <td className="p-4">{tool.capture}</td>
                      <td className="p-4">{tool.markup}</td>
                      <td className="p-4">{tool.mockups}</td>
                      <td className="p-4">{tool.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground/70">
              Details checked on each project&apos;s official site in September
              2026.
            </p>
          </div>
        </section>

        <section className="px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 text-center">
              <h2
                className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
                style={{ fontFamily: INTER }}
              >
                How It Compares to Other Screenshot Editors
              </h2>
              <p className="mx-auto max-w-3xl text-muted-foreground">
                Shots.so, Pika Style, Screely, Xnapper, CleanShot X, and Snagit
                all beautify screenshots too. Screenshot Studio matches the
                core workflow, backgrounds, shadows, mockups, and export, for
                free, in any browser, with no signup.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {alternatives.map((comparison) => {
                const faq = comparison.faqs[0];
                return (
                  <div key={comparison.slug} className={`flex flex-col p-6 ${cardSurface}`}>
                    <h3 className="text-sm font-semibold text-foreground">{faq.q}</h3>
                    <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {faq.a}
                    </p>
                    <Link
                      href={`/compare/${comparison.slug}`}
                      className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-4"
                    >
                      Full {comparison.competitorName} comparison
                      <ArrowRight01Icon size={14} aria-hidden />
                    </Link>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground/70">
              Competitor pricing and features checked on {CLAIMS_CHECKED_LABEL}. See each comparison
              for sourcing, since third-party plans change without notice.
            </p>
          </div>
        </section>

        <section className="border-t border-border px-6 py-20">
          <div className="mx-auto max-w-3xl">
            <div className="mb-16 text-center">
              <h2
                className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
                style={{ fontFamily: INTER }}
              >
                Frequently Asked Questions
              </h2>
              <p className="text-muted-foreground">
                Everything you need to know about our free screenshot editor.
              </p>
            </div>

            <div className="space-y-6">
              {faqs.map((faq) => (
                <div
                  key={faq.q}
                  className="border-b border-border pb-6 last:border-b-0"
                >
                  <h3 className="mb-2 text-lg font-semibold text-foreground">
                    {faq.q}
                  </h3>
                  <p className="text-muted-foreground">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border px-6 py-16">
          <div className="mx-auto max-w-4xl">
            <h2
              className="mb-8 text-center text-2xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Explore More Features
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {featureLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group flex items-center justify-between rounded-md bg-foreground/[0.04] px-4 py-3 text-sm font-medium text-foreground/90 ring-1 ring-border transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
                >
                  <span>{link.label}</span>
                  <ArrowRight01Icon
                    className="size-3.5 text-muted-foreground/70 transition-colors group-hover:text-foreground"
                    aria-hidden
                  />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2
              className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
              style={{ fontFamily: INTER }}
            >
              Start Editing Screenshots for Free
            </h2>
            <p className="mb-8 text-lg text-muted-foreground">
              No signup. No downloads. No watermarks. Just open the editor and
              create.
            </p>
            <Link href="/editor" className={ctaClassName}>
              Open Free Screenshot Editor
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
