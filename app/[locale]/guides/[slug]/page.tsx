import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight01Icon } from "hugeicons-react";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import {
  GUIDES_UPDATED,
  GUIDES_UPDATED_LABEL,
  getGuide,
  guides,
  type GuideTool,
} from "@/lib/seo/guides";
import { PERSON_ID } from "@/lib/seo/json-ld";
import { OG_DEFAULTS, SITE_URL } from "@/lib/seo/metadata";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return guides.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};

  return {
    title: { absolute: guide.title },
    description: guide.metaDescription,
    keywords: guide.keywords,
    openGraph: {
      ...OG_DEFAULTS,
      type: "article",
      title: guide.title,
      description: guide.metaDescription,
      url: `/guides/${guide.slug}`,
    },
    alternates: {
      canonical: `/guides/${guide.slug}`,
    },
  };
}

const ctaClassName =
  "relative inline-flex items-center justify-center rounded-md border-0 bg-[var(--nav-cta-bg)] px-6 py-2.5 text-base font-medium text-[var(--nav-cta-fg)] shadow-none transition-[transform,box-shadow] duration-150 ease-out [text-shadow:var(--nav-cta-text-shadow)] hover:shadow-[var(--nav-cta-hover-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.97]";

const chipLinkClassName =
  "group flex items-center justify-between rounded-md bg-foreground/[0.04] px-4 py-3 text-sm font-medium text-foreground/90 ring-1 ring-border transition-colors hover:bg-foreground/[0.08] hover:text-foreground";

const INTER =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url;
}

function ToolLink({ tool }: { tool: GuideTool }): React.JSX.Element {
  if (tool.url.startsWith("/")) {
    return (
      <Link href={tool.url} className="underline underline-offset-4">
        {tool.name}
      </Link>
    );
  }
  return (
    <a href={tool.url} rel="nofollow noopener" className="underline underline-offset-4">
      {tool.name}
    </a>
  );
}

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const pageUrl = `${SITE_URL}/guides/${guide.slug}`;
  const otherGuides = guides.filter((g) => g.slug !== guide.slug);

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
          { "@type": "ListItem", position: 3, name: guide.title, item: pageUrl },
        ],
      },
      {
        "@type": "Article",
        "@id": `${pageUrl}#article`,
        headline: guide.title,
        description: guide.metaDescription,
        datePublished: GUIDES_UPDATED,
        dateModified: GUIDES_UPDATED,
        author: { "@id": PERSON_ID },
        publisher: { "@id": `${SITE_URL}/#organization` },
        mainEntityOfPage: pageUrl,
      },
      {
        "@type": "ItemList",
        name: guide.title,
        itemListElement: guide.tools.map((tool, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: tool.name,
          url: absoluteUrl(tool.url),
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: guide.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: { "@type": "Answer", text: faq.a },
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
        <section className="px-6 pb-12 pt-32">
          <div className="mx-auto max-w-3xl">
            <p className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Guide
            </p>
            <h1
              className="mb-6 text-4xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl"
              style={{ fontFamily: INTER }}
            >
              {guide.title}
            </h1>
            <p className="mb-6 text-lg text-muted-foreground">{guide.answer}</p>
            <p className="text-sm text-muted-foreground/80">
              Last updated{" "}
              <time dateTime={GUIDES_UPDATED}>{GUIDES_UPDATED_LABEL}</time> by{" "}
              <Link href="/about" className="underline underline-offset-4">
                Kartik Labhshetwar
              </Link>
              , maker of Screenshot Studio. Screenshot Studio is our product;
              every other tool is listed on its merits, with details checked
              against the vendor&apos;s own site.
            </p>
          </div>
        </section>

        <section className="border-t border-border px-6 py-16">
          <div className="mx-auto max-w-5xl">
            <h2
              className="mb-8 text-center text-3xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Quick Comparison
            </h2>
            <div className="overflow-x-auto rounded-2xl bg-card ring-1 ring-inset ring-border shadow-[var(--card-highlight-shadow)]">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-4 text-left text-sm font-semibold text-foreground">
                      Tool
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-muted-foreground">
                      Best for
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-muted-foreground">
                      Price
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-muted-foreground">
                      Runs on
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {guide.tools.map((tool) => (
                    <tr
                      key={tool.name}
                      className="border-b border-border/50 last:border-b-0"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        {tool.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {tool.bestFor}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {tool.price}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {tool.platform}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-t border-border px-6 py-16">
          <div className="mx-auto max-w-3xl space-y-12">
            {guide.tools.map((tool, index) => (
              <article key={tool.name}>
                <h2
                  className="mb-3 text-2xl font-semibold tracking-[-0.03em] text-foreground"
                  style={{ fontFamily: INTER }}
                >
                  {index + 1}. <ToolLink tool={tool} />
                </h2>
                <p className="mb-4 text-muted-foreground">{tool.summary}</p>
                <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
                  <dt className="font-medium text-foreground">Best for</dt>
                  <dd className="text-muted-foreground">{tool.bestFor}</dd>
                  <dt className="font-medium text-foreground">Price</dt>
                  <dd className="text-muted-foreground">{tool.price}</dd>
                  <dt className="font-medium text-foreground">Runs on</dt>
                  <dd className="text-muted-foreground">{tool.platform}</dd>
                  <dt className="font-medium text-foreground">Limitations</dt>
                  <dd className="text-muted-foreground">{tool.limitations}</dd>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-border px-6 py-16">
          <div className="mx-auto max-w-3xl">
            <h2
              className="mb-4 text-2xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              How We Picked
            </h2>
            <p className="text-muted-foreground">
              {guide.criteria} Every detail comes from each vendor&apos;s own
              site or repository, checked on {GUIDES_UPDATED_LABEL}. Plans
              change without notice, so confirm current pricing before you
              decide.
            </p>
          </div>
        </section>

        <section className="border-t border-border px-6 py-20">
          <div className="mx-auto max-w-3xl">
            <h2
              className="mb-12 text-center text-3xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              Frequently Asked Questions
            </h2>
            <div className="space-y-6">
              {guide.faqs.map((faq) => (
                <div key={faq.q} className="border-b border-border pb-6">
                  <h3
                    className="mb-2 text-lg font-semibold tracking-[-0.02em] text-foreground"
                    style={{ fontFamily: INTER }}
                  >
                    {faq.q}
                  </h3>
                  <p className="text-muted-foreground">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border px-6 py-16">
          <div className="mx-auto max-w-4xl">
            <h2
              className="mb-8 text-center text-2xl font-semibold tracking-[-0.03em] text-foreground"
              style={{ fontFamily: INTER }}
            >
              More Guides
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {otherGuides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/guides/${g.slug}`}
                  className={chipLinkClassName}
                >
                  <span>{g.title}</span>
                  <ArrowRight01Icon
                    size={14}
                    strokeWidth={1.75}
                    className="size-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
                  />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border px-6 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2
              className="mb-4 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-4xl"
              style={{ fontFamily: INTER }}
            >
              Try Screenshot Studio Free
            </h2>
            <p className="mb-8 text-lg text-muted-foreground">
              No signup. No downloads. No watermarks.
            </p>
            <Link href="/" className={ctaClassName}>
              Open Free Editor
            </Link>
          </div>
        </section>
      </main>

      <Footer brandName="Screenshot Studio" />
    </div>
  );
}
