import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight01Icon } from "hugeicons-react";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import { CLAIMS_CHECKED_LABEL, comparisons } from "@/lib/seo/comparisons";
import { buildCollectionJsonLd } from "@/lib/seo/json-ld";
import { OG_DEFAULTS } from "@/lib/seo/metadata";

const TITLE = "Screenshot Studio Alternatives Compared";
const DESCRIPTION =
  "Side-by-side comparisons of Screenshot Studio against Pika Style, Shots.so, CleanShot X, Snagit, Xnapper, Screely, Carbon, Ray.so, and remove.bg.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "screenshot editor comparison",
    "pika style alternative",
    "shots.so alternative",
    "cleanshot x alternative",
    "snagit alternative",
    "xnapper alternative",
    "screely alternative",
    "carbon alternative",
    "ray.so alternative",
    "remove.bg alternative",
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: `${TITLE} - Screenshot Studio`,
    description: DESCRIPTION,
    url: "/compare",
  },
  alternates: {
    canonical: "/compare",
  },
};

export default function CompareHubPage() {
  const jsonLd = buildCollectionJsonLd(
    "/compare",
    TITLE,
    DESCRIPTION,
    comparisons.map((comparison) => ({
      name: `Screenshot Studio vs ${comparison.competitorName}`,
      url: `/compare/${comparison.slug}`,
    })),
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navigation />

      <main className="bg-background">
        <section className="px-6 pt-28 pb-12">
          <div className="mx-auto max-w-5xl">
            <h1 className="mb-3 text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
              How Screenshot Studio Compares
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground">
              Honest, feature-by-feature breakdowns against the tools people
              weigh Screenshot Studio against. Each page lists what the
              alternative costs, where it is genuinely stronger, and where
              Screenshot Studio does more for free.
            </p>
          </div>
        </section>

        <section className="px-6 pb-16">
          <div className="mx-auto max-w-5xl">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {comparisons.map((comparison) => (
                <Link
                  key={comparison.slug}
                  href={`/compare/${comparison.slug}`}
                  className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/25"
                >
                  <span className="mb-1.5 flex items-center justify-between gap-2 text-base font-medium text-foreground">
                    vs {comparison.competitorName}
                    <ArrowRight01Icon
                      size={16}
                      className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {comparison.tagline}
                  </span>
                  <span className="mt-3 text-xs text-muted-foreground/80">
                    {comparison.competitorName} pricing:{" "}
                    {comparison.competitorPricing}
                  </span>
                </Link>
              ))}
            </div>

            <p className="mt-8 max-w-2xl text-xs text-muted-foreground/80">
              All competitor pricing and feature details on these pages were
              checked on {CLAIMS_CHECKED_LABEL} against each vendor&apos;s own
              site. Third-party plans change without notice, so confirm current
              pricing before deciding.
            </p>

            <p className="mt-12 max-w-2xl text-sm text-muted-foreground">
              Rather just try it? Open the{" "}
              <Link href="/editor" className="underline">
                Screenshot Studio editor
              </Link>
              , browse the{" "}
              <Link href="/tools" className="underline">
                free image tools
              </Link>
              , or read what it does for{" "}
              <Link href="/for/developers" className="underline">
                developers
              </Link>
              ,{" "}
              <Link href="/for/designers" className="underline">
                designers
              </Link>
              , and{" "}
              <Link href="/for/marketers" className="underline">
                marketers
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
