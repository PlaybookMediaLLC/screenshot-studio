import { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight01Icon,
  CpuIcon,
  Download04Icon,
  EraserAutoIcon,
  SecurityLockIcon,
} from "hugeicons-react";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import { OG_DEFAULTS } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: "AI Background Remover: Free, Private, On-Device",
  description:
    "Free AI background remover that runs on your device. Get a full-resolution transparent PNG without uploading your image. No signup, no watermark, no credits.",
  keywords: [
    "background remover",
    "ai background remover",
    "remove background from image",
    "remove background free",
    "transparent background maker",
    "remove.bg alternative",
    "private background remover",
    "background remover no upload",
    "offline background remover",
    "remove background full resolution free",
    "png background remover",
    "photo background eraser",
    "cut out subject from photo",
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: "AI Background Remover - Screenshot Studio",
    description:
      "Remove image backgrounds on your own device and download a full-resolution transparent PNG. Free, no signup, no upload.",
    url: "/features/background-remover",
  },
  alternates: {
    canonical: "/features/background-remover",
  },
};

const INTER = 'Inter, "Inter Fallback", Arial, Helvetica, sans-serif';

const ctaClassName =
  "relative inline-flex items-center justify-center rounded-md border-0 bg-[var(--nav-cta-bg)] px-6 py-2.5 text-base font-medium text-[var(--nav-cta-fg)] shadow-none transition-[transform,box-shadow] duration-150 ease-out [text-shadow:var(--nav-cta-text-shadow)] hover:shadow-[var(--nav-cta-hover-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.97]";

const cardSurface =
  "rounded-2xl bg-card ring-1 ring-border shadow-[var(--card-edge-shadow)]";

const chipLinkClassName =
  "group flex items-center justify-between rounded-md bg-foreground/[0.04] px-4 py-3 text-sm font-medium text-foreground/90 ring-1 ring-border transition-colors hover:bg-foreground/[0.08] hover:text-foreground";

const features = [
  {
    icon: SecurityLockIcon,
    title: "Your Image Never Leaves Your Device",
    description:
      "The AI model runs inside your browser tab. Photos of people, products, and documents are processed locally and never sent to a server.",
  },
  {
    icon: Download04Icon,
    title: "Full Resolution, No Credits",
    description:
      "The transparent PNG keeps the exact size of your original image. There are no low-resolution previews, credit packs, or watermarks.",
  },
  {
    icon: CpuIcon,
    title: "WebGPU Speed, Works Offline",
    description:
      "Runs on your graphics card with WebGPU, or on the CPU with WebAssembly. The model is cached after the first image, so it keeps working offline.",
  },
  {
    icon: EraserAutoIcon,
    title: "Crisp or Soft Edges",
    description:
      "Clean, sharp cutouts for products and logos, or soft edges that keep hair and fur. Switch instantly and compare with a before and after slider.",
  },
] as const;

const howToSteps = [
  {
    step: "1",
    title: "Select or Drop an Image",
    description:
      "Open the background remover and choose a PNG, JPG, WebP, or AVIF photo up to 50 MB, or drag it onto the page.",
  },
  {
    step: "2",
    title: "Let the Model Cut It Out",
    description:
      "BiRefNet-lite finds the subject and removes the background on your device. The first run downloads the model once; later runs start right away.",
  },
  {
    step: "3",
    title: "Download a Transparent PNG",
    description:
      "Pick crisp or soft edges, check the result with the comparison slider, and download the PNG at full resolution.",
  },
];

const faqs = [
  {
    question: "Is the background remover really free?",
    answer:
      "Yes. There is no signup, no credit system, no watermark, and no limit on how many images you process. Every download is full resolution.",
  },
  {
    question: "Is my photo uploaded to a server?",
    answer:
      "No. The image is decoded, processed, and saved as a PNG inside your browser. The only network request is a one-time download of the model weights from Hugging Face, and it contains no image data.",
  },
  {
    question: "How does it compare to remove.bg?",
    answer:
      "remove.bg processes images on its servers and gives free downloads as previews of up to 0.25 megapixels, with full-resolution downloads costing credits. Screenshot Studio runs on your device and returns full resolution for free. remove.bg's server models can still resolve fine hair detail better on difficult photos.",
  },
  {
    question: "What kinds of images work best?",
    answer:
      "Photos with a clear main subject: people, pets, products, cars, and objects. Busy scenes with several overlapping subjects, or subjects that blend into the background, are harder for any background remover.",
  },
  {
    question: "Which browsers are supported?",
    answer:
      "Recent Chrome, Edge, Firefox, and Safari. Browsers with WebGPU use the graphics card and download a 98 MB model; others fall back to WebAssembly with a 192 MB model.",
  },
];

const relatedLinks = [
  { href: "/remove-background", label: "Open the Background Remover" },
  { href: "/compare/remove-bg", label: "vs remove.bg" },
  { href: "/tools", label: "Image Tools" },
  { href: "/features/screenshot-beautifier", label: "Screenshot Beautifier" },
  { href: "/features", label: "All Features" },
] as const;

export default function BackgroundRemoverFeaturePage() {
  const breadcrumb = {
    "@context": "https://schema.org",
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
        name: "Features",
        item: "https://www.screenshot-studio.com/features",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Background Remover",
        item: "https://www.screenshot-studio.com/features/background-remover",
      },
    ],
  };

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Screenshot Studio - Background Remover",
        url: "https://www.screenshot-studio.com/remove-background",
        applicationCategory: "DesignApplication",
        operatingSystem: "Web Browser",
        description:
          "Free AI background remover that runs on your device and exports a full-resolution transparent PNG without uploading the image.",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: [
          "On-device AI background removal, no image upload",
          "Full-resolution transparent PNG with no credits or watermark",
          "WebGPU acceleration with WebAssembly fallback",
          "Crisp and soft edge styles with a before and after slider",
          "Works offline after the first image",
        ],
      },
      {
        "@type": "HowTo",
        name: "How to Remove the Background From an Image",
        description:
          "Remove an image background and download a transparent PNG in three steps with Screenshot Studio.",
        totalTime: "PT1M",
        tool: {
          "@type": "HowToTool",
          name: "Screenshot Studio Background Remover",
        },
        step: howToSteps.map((item, index) => ({
          "@type": "HowToStep",
          name: item.title,
          text: item.description,
          position: index + 1,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <Navigation brandName="Screenshot Studio" />

      <main className="flex-1">
        <section className="px-6 pb-20 pt-32">
          <div className="mx-auto max-w-4xl text-center">
            <h1
              className="mb-6 text-4xl font-semibold tracking-[-0.03em] text-foreground md:text-6xl"
              style={{ fontFamily: INTER }}
            >
              Remove Image Backgrounds on Your Device
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground md:text-xl">
              An AI background remover that runs in your browser. Get a
              transparent PNG at full resolution, with no upload, no credits,
              and no watermark.
            </p>
            <div className="flex flex-col items-center">
              <Link href="/remove-background" className={ctaClassName}>
                Remove a Background
              </Link>
              <p className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground/70">
                <span>100% Free</span>
                <span className="h-3 w-px bg-border" aria-hidden />
                <span>No Upload</span>
                <span className="h-3 w-px bg-border" aria-hidden />
                <span>No Signup</span>
              </p>
            </div>
          </div>
        </section>

        <section className="border-y border-border px-6 py-16">
          <div className="mx-auto max-w-6xl">
            <h2
              className="mb-12 text-center text-3xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              A Background Remover That Respects Your Photos
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className={`flex gap-4 p-6 ${cardSurface}`}
                >
                  <feature.icon
                    className="size-6 shrink-0 text-foreground"
                    aria-hidden
                  />
                  <div>
                    <h3 className="mb-2 text-lg font-semibold text-foreground">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-16">
          <div className="mx-auto max-w-4xl">
            <h2
              className="mb-12 text-center text-3xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              How It Works
            </h2>
            <div className="space-y-8">
              {howToSteps.map((item) => (
                <div key={item.step} className="flex items-start gap-6">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                    {item.step}
                  </div>
                  <div>
                    <h3 className="mb-1 text-lg font-semibold text-foreground">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border px-6 py-16">
          <div className="mx-auto max-w-3xl">
            <h2
              className="mb-12 text-center text-3xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {faqs.map((faq) => (
                <div key={faq.question} className={`p-6 ${cardSurface}`}>
                  <h3 className="mb-2 font-semibold text-foreground">
                    {faq.question}
                  </h3>
                  <p className="text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-16">
          <div className="mx-auto max-w-4xl">
            <h2
              className="mb-8 text-center text-2xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Explore More
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {relatedLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={chipLinkClassName}
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

        <section className="border-t border-border px-6 py-20">
          <div className="mx-auto max-w-4xl text-center">
            <h2
              className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Ready to Remove a Background?
            </h2>
            <p className="mb-8 text-muted-foreground">
              Free, private, and no account needed.
            </p>
            <Link href="/remove-background" className={ctaClassName}>
              Open the Background Remover
            </Link>
          </div>
        </section>
      </main>

      <Footer brandName="Screenshot Studio" />
    </div>
  );
}
