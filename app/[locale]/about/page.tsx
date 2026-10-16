import { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import { CHANGELOG, LATEST_VERSION } from "@/lib/seo/changelog";
import { CLAIMS_CHECKED_LABEL, comparisons } from "@/lib/seo/comparisons";
import { GUIDES_UPDATED_LABEL, HOW_TO_UPDATED, formatGuideDate, guides } from "@/lib/seo/guides";
import { PRODUCT_FACTS, atLeast } from "@/lib/seo/product-facts";
import { TOOLS } from "@/lib/seo/tools";

export const metadata: Metadata = {
  title: { absolute: "About Shots" },
  description:
    "About Shots, the launch platform that turns every release into polished, ready-to-publish content.",
  alternates: {
    canonical: "/about",
  },
};

const cardSurface =
  "rounded-2xl bg-card p-4 ring-1 ring-inset ring-border shadow-[var(--card-highlight-shadow)]";

const linkClassName =
  "text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground/60";

const INTER =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const offerings = [
  {
    title: `${atLeast(PRODUCT_FACTS.backgrounds)} backgrounds`,
    description:
      "Gradient backgrounds, solid colors, and patterns.",
  },
  {
    title: "Browser and device mockups",
    description:
      "Safari and Chrome browser frames, window frames, and iPhone, MacBook, and Apple Watch mockups.",
  },
  {
    title: "3D effects & animations",
    description:
      "Perspective transforms, shadows, and animation timelines with video export.",
  },
  {
    title: "Tweet, code, and App Store editors",
    description:
      "Turn posts and code snippets into shareable images, and lay out App Store screenshots.",
  },
  {
    title: `${TOOLS.length} image tools`,
    description:
      "Compress, convert, resize, crop, and rotate images in your browser, without uploading them.",
  },
  {
    title: "Background remover",
    description:
      "An AI model that runs on your device and returns a full-resolution transparent PNG.",
  },
];

const latestRelease = CHANGELOG[0];

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Navigation />

      <main className="mx-auto max-w-3xl flex-1 px-6 pb-16 pt-28 sm:pb-24">
        <h1
          className="mb-6 text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl"
          style={{ fontFamily: INTER }}
        >
          About Shots
        </h1>

        <div className="space-y-8">
          <section>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Shots is a launch platform. It reads a software release, writes a
              cited launch brief, designs on-brand visuals, and drafts posts,
              and nothing ships until a person approves. Every plan includes an
              open-source screenshot editor with no watermark.
            </p>
          </section>

          <section>
            <h2
              className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Why we built this
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              Every time you share a screenshot on social media, in
              documentation, or on a landing page, presentation matters. But
              existing tools either cost too much, add watermarks, or upload
              your images to their servers just to edit them. We wanted an
              editor that runs in your browser and keeps your images on your
              device.
            </p>
          </section>

          <section>
            <h2
              className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              What we offer
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {offerings.map((item) => (
                <div key={item.title} className={cardSurface}>
                  <p className="mb-1 font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2
              className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              How we write guides and comparisons
            </h2>
            <p className="mb-3 leading-relaxed text-muted-foreground">
              The site publishes {guides.length} guides and {comparisons.length}{" "}
              head-to-head comparisons. They follow a few rules:
            </p>
            <ul className="list-inside list-disc space-y-2 text-muted-foreground">
              <li>
                Every how-to guide is written by doing the task in the current
                editor, step by step. They were last checked on{" "}
                {formatGuideDate(HOW_TO_UPDATED)}.
              </li>
              <li>
                Claims about other tools (prices, watermarks, export formats,
                account requirements) come from each vendor&apos;s own website.
                Roundups were last checked on {GUIDES_UPDATED_LABEL} and
                comparisons on {CLAIMS_CHECKED_LABEL}.
              </li>
              <li>
                When another tool is the better choice for a job, we say so,
                and we list Shots&apos; own limitations next to its
                strengths.
              </li>
              <li>
                No one pays to be included or ranked, and there are no affiliate
                links.
              </li>
            </ul>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Spot something out of date or wrong? Tell us on the{" "}
              <Link href="/contact" className={linkClassName}>
                contact page
              </Link>{" "}
              and we will correct it.
            </p>
          </section>

          <section>
            <h2
              className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              How we keep it current
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              Shots ships regularly, and every release is written up
              in the{" "}
              <Link href="/changelog" className={linkClassName}>
                changelog
              </Link>
              . The latest release is version {LATEST_VERSION}, &quot;
              {latestRelease.title}&quot;, from {latestRelease.date}. Guides and
              comparisons show the date they were last checked, and pages are
              updated when the editor or a compared tool changes.
            </p>
          </section>

          <section>
            <h2
              className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              How the site is funded
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              The editor and image tools are included in every plan, with no
              watermark. Paid plans (Pro, Business, and Enterprise) fund the
              platform, and Google AdSense ads run on content pages. Ads
              never affect what we recommend in guides or comparisons. The{" "}
              <Link href="/privacy-policy" className={linkClassName}>
                privacy policy
              </Link>{" "}
              explains how ads use cookies and how to opt out of personalized
              ads.
            </p>
          </section>

          <section>
            <h2
              className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Open source
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              Shots is fully open source. You can view, contribute
              to, or fork the project on{" "}
              <Link
                href="https://github.com/PlaybookMediaLLC/screenshot-studio"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClassName}
              >
                GitHub
              </Link>
              . We believe the best tools are built in the open.
            </p>
          </section>

          <section>
            <h2
              className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Built by
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              Built and maintained by Playbook Media, with contributions from the
              open-source community on GitHub. You can reach the team at{" "}
              <Link
                href="mailto:team@playbookmedia.io"
                className={linkClassName}
              >
                team@playbookmedia.io
              </Link>
              . If you find Shots useful, consider starring the repo
              or sharing it with others.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
