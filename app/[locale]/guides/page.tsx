import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight01Icon } from "hugeicons-react";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import { GUIDES_UPDATED_LABEL, guides } from "@/lib/seo/guides";
import { buildCollectionJsonLd } from "@/lib/seo/json-ld";
import { OG_DEFAULTS } from "@/lib/seo/metadata";

const TITLE = "Screenshot and Mockup Tool Guides";
const DESCRIPTION =
  "Honest, dated roundups of the best free screenshot editors, mockup generators, code to image tools, and Shots.so alternatives, with prices and limits checked against each vendor's site.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "best free screenshot editor",
    "best free mockup generator",
    "best code to image tool",
    "shots.so alternatives",
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: `${TITLE} - Screenshot Studio`,
    description: DESCRIPTION,
    url: "/guides",
  },
  alternates: {
    canonical: "/guides",
  },
};

export default function GuidesHubPage() {
  const jsonLd = buildCollectionJsonLd(
    "/guides",
    TITLE,
    DESCRIPTION,
    guides.map((guide) => ({ name: guide.title, url: `/guides/${guide.slug}` })),
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
              Guides
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground">
              Roundups of the tools people compare when they edit, frame, and
              share screenshots. Each guide lists what a tool costs, what it
              does well, and where it falls short, including Screenshot Studio.
            </p>
          </div>
        </section>

        <section className="px-6 pb-16">
          <div className="mx-auto max-w-5xl">
            <div className="grid gap-4 sm:grid-cols-2">
              {guides.map((guide) => (
                <Link
                  key={guide.slug}
                  href={`/guides/${guide.slug}`}
                  className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/25"
                >
                  <span className="mb-1.5 flex items-center justify-between gap-2 text-base font-medium text-foreground">
                    {guide.title}
                    <ArrowRight01Icon
                      size={16}
                      className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {guide.metaDescription}
                  </span>
                </Link>
              ))}
            </div>

            <p className="mt-8 max-w-2xl text-xs text-muted-foreground/80">
              Last updated {GUIDES_UPDATED_LABEL}. For head-to-head breakdowns,
              see the{" "}
              <Link href="/compare" className="underline">
                comparisons
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
