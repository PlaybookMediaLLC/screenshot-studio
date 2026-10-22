import { Metadata } from "next";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import Link from "next/link";
import { OG_DEFAULTS } from "@/lib/seo/metadata";
import { PaletteIcon as PaintBoardIcon } from "@phosphor-icons/react/dist/ssr/Palette"
import { PaletteIcon as ColorsIcon } from "@phosphor-icons/react/dist/ssr/Palette"
import { PenIcon as PenTool01Icon } from "@phosphor-icons/react/dist/ssr/Pen"
import { DeviceMobileIcon as SmartPhone01Icon } from "@phosphor-icons/react/dist/ssr/DeviceMobile"
import { StackIcon as Layers01Icon } from "@phosphor-icons/react/dist/ssr/Stack"
import { EyeIcon as EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye"
import { SparkleIcon as SparklesIcon } from "@phosphor-icons/react/dist/ssr/Sparkle";

export const metadata: Metadata = {
  title: "Mockup & Screenshot Tool for Designers",
  description:
    "Mockup tool for UI/UX designers. Create app mockups, UI mockups, and portfolio screenshots with backgrounds, browser frames, and 3D effects. Included in every Shots plan.",
  keywords: [
    "screenshot tool for designers",
    "UI mockup creator",
    "design portfolio screenshots",
    "designer screenshot editor",
    "mockup screenshot",
    "mockup online",
    "mockup screen",
    "mockups ui",
    "mockup ui ux",
    "app mockup generator",
    "ui mockup generator",
    "shots app alternative",
    "shots net alternative",
    "moqups alternative",
    "previewed app alternative",
    "appshots alternative",
    "goodmockups alternative",
    "mockup me alternative",
    "mockup generator",
    "mockup online generator",
    "mockup online editor",
    "mockup editor online",
    "mockup design online",
    "online mockup generator no watermark",
    "mockup generator without watermark",
    "app mockup generator",
    "website mockup generator",
    "website mockup generator from url",
    "laptop mockup generator",
    "product mockup generator",
    "online 3d mockup generator",
    "best mockup generator",
    "best online mockup generator",
    "mockup app",
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: "Mockup & Screenshot Tool for Designers",
    description:
      "Create app mockups, UI mockups, and portfolio screenshots with backgrounds, browser frames, and 3D effects. Included in every Shots plan.",
    url: "/for/designers",
  },
  alternates: {
    canonical: "/for/designers",
  },
};

const ctaClassName =
  "relative inline-flex items-center justify-center rounded-md border-0 bg-[var(--nav-cta-bg)] px-6 py-2.5 text-base font-medium text-[var(--nav-cta-fg)] shadow-none transition-[transform,box-shadow] duration-150 ease-out [text-shadow:var(--nav-cta-text-shadow)] hover:shadow-[var(--nav-cta-hover-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.97]";

const secondaryCtaClassName =
  "inline-flex items-center justify-center rounded-md px-6 py-2.5 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground active:scale-[0.99]";

const cardSurface =
  "rounded-2xl bg-card p-6 ring-1 ring-inset ring-border shadow-[var(--card-highlight-shadow)]";

const INTER =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const useCases = [
  {
    icon: PaintBoardIcon,
    title: "Portfolio presentations",
    description:
      "Present your UI designs in device and browser mockups",
  },
  {
    icon: ColorsIcon,
    title: "Client presentations",
    description:
      "Create polished mockups for client reviews and design presentations",
  },
  {
    icon: PenTool01Icon,
    title: "Design systems",
    description:
      "Document your design systems with clear, consistent visual examples",
  },
  {
    icon: SmartPhone01Icon,
    title: "App Store assets",
    description:
      "Make screenshots for App Store and Play Store listings",
  },
];

const features = [
  {
    icon: Layers01Icon,
    title: "Advanced layering",
    description: "Full control over layers, shadows, and visual hierarchy",
  },
  {
    icon: EyeIcon,
    title: "Precise controls",
    description: "Pixel-level control over position, scale, and rotation",
  },
  {
    icon: ColorsIcon,
    title: "Color palettes",
    description: "Gradients and solid colors to match any brand",
  },
  {
    icon: SparklesIcon,
    title: "Export options",
    description: "High-resolution exports in multiple formats",
  },
];

export default function ForDesignersPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navigation />

      <section className="relative overflow-hidden pt-32 pb-20">
        <div className="container mx-auto px-6">
          <div className="mx-auto max-w-4xl text-center">
            <p
              className="mb-6 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              style={{ fontFamily: INTER }}
            >
              Built for Designers
            </p>
            <h1
              className="mb-6 text-5xl font-semibold tracking-[-0.04em] text-foreground md:text-6xl"
              style={{ fontFamily: INTER }}
            >
              Design tools that match your standards
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-xl leading-relaxed text-muted-foreground">
              Create portfolio-worthy screenshots and mockups with the precision
              and control that designers demand. No compromises on quality.
            </p>
            <div className="mb-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/editor" className={ctaClassName}>
                Start Designing
              </Link>
              <Link href="/features" className={secondaryCtaClassName}>
                See All Features
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="container mx-auto px-6">
          <div className="mb-16 text-center">
            <h2
              className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
              style={{ fontFamily: INTER }}
            >
              Perfect for every design workflow
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              From client presentations to portfolio pieces, we&apos;ve got you
              covered
            </p>
          </div>

          <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2">
            {useCases.map((useCase) => (
              <div key={useCase.title} className={cardSurface}>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground ring-1 ring-inset ring-border">
                  <useCase.icon size={24} />
                </div>
                <h3
                  className="mb-2 text-xl font-semibold tracking-[-0.02em] text-foreground"
                  style={{ fontFamily: INTER }}
                >
                  {useCase.title}
                </h3>
                <p className="text-muted-foreground">{useCase.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="container mx-auto px-6">
          <div className="mb-16 text-center">
            <h2
              className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
              style={{ fontFamily: INTER }}
            >
              Features designers love
            </h2>
          </div>

          <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div key={feature.title} className={`${cardSurface} text-center`}>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground ring-1 ring-inset ring-border">
                  <feature.icon size={24} />
                </div>
                <h3
                  className="mb-2 text-lg font-semibold tracking-[-0.02em] text-foreground"
                  style={{ fontFamily: INTER }}
                >
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="container mx-auto px-6">
          <div className="mx-auto max-w-3xl">
            <h2
              className="mb-6 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
              style={{ fontFamily: INTER }}
            >
              A mockup tool built for UI and UX work
            </h2>
            <div className="space-y-4 text-lg leading-relaxed text-muted-foreground">
              <p>
                Export a frame from Figma, Sketch, or your running app, drop it
                into Shots, and get a presentation-ready UI mockup in
                under a minute. Pick a browser frame or a clean device-style
                window, set the padding and corner radius, and choose from more
                than a hundred gradient and solid backgrounds.
              </p>
              <p>
                For case studies and Dribbble shots, tilt the mockup in 3D to
                add depth, or stack several screens into an animated walkthrough
                and export it as a video. Everything renders at high resolution
                so your work looks sharp on portfolio sites, Behance, and
                LinkedIn.
              </p>
              <p>
                Shots is open source and the editor is included in every
                plan, so you can use it for client work without extra licenses
                or watermarks.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="container mx-auto px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2
              className="mb-6 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
              style={{ fontFamily: INTER }}
            >
              Ready to present your designs?
            </h2>
            <p className="mb-8 text-xl text-muted-foreground">
              The editor and image tools are included in every plan.
            </p>
            <Link href="/editor" className={ctaClassName}>
              Start Creating
            </Link>
          </div>
        </div>
      </section>

      <Footer brandName="Shots" />
    </div>
  );
}
