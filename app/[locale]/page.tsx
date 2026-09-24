import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight01Icon } from "hugeicons-react";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import { CODE_THEME_SOURCES } from "@/components/code-image/code-themes-data";
import { gradientColors } from "@/lib/constants/gradient-colors";
import { OG_DEFAULTS } from "@/lib/seo/metadata";
import { PRODUCT_FACTS } from "@/lib/seo/product-facts";
import { PRIMARY_TOOLS, TOOLS_HUB_PATH } from "@/lib/seo/tools";
import {
  MAX_STORE_SLIDES,
  STORE_OUTPUT_PROFILES,
} from "@/lib/store-screenshots/config";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Free browser editors for screenshots, code images, and App Store screenshots, plus image tools that compress, convert, and resize without uploading. No signup, no watermark.";

export const metadata: Metadata = {
  title: "Free Screenshot Editor & Image Tools",
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    ...OG_DEFAULTS,
    title: "Screenshot Studio - Free Screenshot Editor & Image Tools",
    description: DESCRIPTION,
    url: "/",
  },
};

const INTER =
  "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const monoClassName =
  "font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-[0.08em]";

const CODE_THEME =
  CODE_THEME_SOURCES.find((theme) => theme.id === "midnight") ??
  CODE_THEME_SOURCES[0];
const SYNTAX = CODE_THEME.dark;

const CODE_LINES: [string, string | undefined][][] = [
  [
    ["async function ", SYNTAX.keyword],
    ["fetchUser", SYNTAX.function],
    ["(", SYNTAX.punctuation],
    ["id", SYNTAX.parameter],
    [") {", SYNTAX.punctuation],
  ],
  [
    ["  const ", SYNTAX.keyword],
    ["res ", SYNTAX.foreground],
    ["= ", SYNTAX.punctuation],
    ["await ", SYNTAX.keyword],
    ["fetch", SYNTAX.function],
    ["(", SYNTAX.punctuation],
    ["url", SYNTAX.foreground],
    [");", SYNTAX.punctuation],
  ],
  [
    ["  return ", SYNTAX.keyword],
    ["res", SYNTAX.foreground],
    [".", SYNTAX.punctuation],
    ["json", SYNTAX.function],
    ["();", SYNTAX.punctuation],
  ],
  [["}", SYNTAX.punctuation]],
];

const STORE_PROFILE = STORE_OUTPUT_PROFILES[0];
const STORE_HEADLINES = ["Plan your week", "Stay on track", "Share progress"];

const IMAGE_TOOL_LINKS = [
  ...PRIMARY_TOOLS.map((tool) => ({ href: tool.slug, label: tool.name })),
  { href: "/remove-background", label: "Remove Background" },
];

function WindowDots(): React.JSX.Element {
  return (
    <div className="flex gap-1.5">
      <span className="size-2 rounded-full bg-[#ff5f57]" />
      <span className="size-2 rounded-full bg-[#febc2e]" />
      <span className="size-2 rounded-full bg-[#28c840]" />
    </div>
  );
}

function ScreenshotPreview(): React.JSX.Element {
  return (
    <div
      className="absolute inset-2 flex items-center justify-center overflow-hidden rounded-xl [perspective:1400px]"
      style={{ background: gradientColors.orange_pink_dark }}
    >
      <div className="w-[76%] max-w-[460px] overflow-hidden rounded-lg bg-white shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55)] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] [transform:rotateX(14deg)_rotateY(-20deg)_rotateZ(4deg)] group-hover:[transform:none] motion-reduce:transition-none">
        <div className="flex items-center gap-3 border-b border-black/[0.06] bg-neutral-100 px-3 py-2">
          <WindowDots />
          <span className="h-3.5 flex-1 rounded bg-black/[0.06]" />
        </div>
        <div className="space-y-2.5 p-5 sm:p-6">
          <div className="h-2 w-14 rounded-full bg-neutral-300" />
          <div className="h-3.5 w-4/5 rounded bg-neutral-800" />
          <div className="h-3.5 w-1/2 rounded bg-neutral-800" />
          <div className="h-2 w-2/3 rounded-full bg-neutral-300" />
          <div className="h-5 w-20 rounded-md bg-neutral-900" />
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="aspect-[4/3] rounded bg-neutral-100" />
            <div className="aspect-[4/3] rounded bg-neutral-100" />
            <div className="aspect-[4/3] rounded bg-neutral-100" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CodePreview(): React.JSX.Element {
  return (
    <div
      className="absolute inset-2 flex items-center justify-center overflow-hidden rounded-xl p-6"
      style={{
        background: `linear-gradient(140deg, ${CODE_THEME.from}, ${CODE_THEME.to})`,
      }}
    >
      <div className="rounded-lg bg-black/75 p-4 pr-6 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.6)] ring-1 ring-white/10 transition-transform duration-500 ease-out group-hover:-translate-y-1 motion-reduce:transition-none">
        <WindowDots />
        <pre className="mt-3 font-[family-name:var(--font-geist-mono)] text-[11px] leading-[18px]">
          {CODE_LINES.map((line, lineIndex) => (
            <div key={lineIndex} className="whitespace-pre">
              <span
                className="mr-3 inline-block w-2 text-right"
                style={{ color: SYNTAX.comment }}
              >
                {lineIndex + 1}
              </span>
              {line.map(([text, color], tokenIndex) => (
                <span key={tokenIndex} style={{ color }}>
                  {text}
                </span>
              ))}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function StorePreview(): React.JSX.Element {
  return (
    <div
      className="absolute inset-2 flex items-end justify-center gap-3 overflow-hidden rounded-xl px-6"
      style={{ background: gradientColors.store_raycast }}
    >
      {STORE_HEADLINES.map((headline, index) => (
        <div
          key={headline}
          className={cn(
            "-mb-6 flex w-[72px] flex-col items-center gap-2 transition-transform duration-500 ease-out motion-reduce:transition-none",
            index === 1
              ? "-translate-y-3 group-hover:-translate-y-5"
              : "group-hover:-translate-y-1",
          )}
        >
          <p className="text-center text-[9px] font-semibold leading-tight text-white">
            {headline}
          </p>
          <div className="h-[118px] w-full rounded-t-[14px] bg-white p-1.5 pt-2 ring-[3px] ring-black">
            <div className="mx-auto h-1.5 w-6 rounded-full bg-black" />
            <div className="mt-3 space-y-1.5 px-1">
              <div className="h-1.5 w-3/4 rounded-full bg-neutral-800" />
              <div className="h-1 w-full rounded-full bg-neutral-200" />
              <div className="h-1 w-5/6 rounded-full bg-neutral-200" />
              <div className="mt-2 h-8 rounded-md bg-neutral-100" />
              <div className="h-1 w-2/3 rounded-full bg-neutral-200" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface EditorCardProps {
  href: string;
  title: string;
  spec: string;
  description: string;
  preview: React.ReactNode;
  className?: string;
}

function EditorCard({
  href,
  title,
  spec,
  description,
  preview,
  className,
}: EditorCardProps): React.JSX.Element {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-inset ring-border shadow-[var(--card-highlight-shadow)] transition-shadow duration-200 hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70",
        className,
      )}
    >
      <div aria-hidden="true" className="relative min-h-52 flex-1">
        {preview}
      </div>
      <div className="flex items-end justify-between gap-4 px-5 pb-5 pt-3">
        <div className="min-w-0">
          <p className={cn(monoClassName, "text-muted-foreground")}>{spec}</p>
          <h2
            className="mt-2 text-lg font-semibold tracking-[-0.02em] text-foreground"
            style={{ fontFamily: INTER }}
          >
            {title}
          </h2>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground ring-1 ring-border transition-colors duration-200 group-hover:bg-foreground group-hover:text-background group-hover:ring-foreground">
          <ArrowRight01Icon size={16} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

export default function StartPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navigation />

      <main className="flex-1 px-6 pb-20 pt-16 sm:pt-20">
        <div className="mx-auto max-w-6xl">
          <h1
            className="text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl"
            style={{ fontFamily: INTER }}
          >
            What are you making?
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Choose a tool to start. Free, no signup, no watermark.
          </p>

          <div className="mt-10 grid gap-3 lg:grid-cols-[1.4fr_1fr] lg:grid-rows-2">
            <EditorCard
              href="/editor"
              title="Screenshot Editor"
              spec="PNG · JPG · WebP · MP4 · WebM · GIF"
              description="Put any screenshot on a background, frame it in a browser or device, and add shadows, 3D tilt, and animation."
              preview={<ScreenshotPreview />}
              className="lg:row-span-2 [&>div:first-child]:min-h-72 lg:[&>div:first-child]:min-h-80"
            />
            <EditorCard
              href="/code"
              title="Code Images"
              spec={`${PRODUCT_FACTS.codeThemes} themes · ${PRODUCT_FACTS.codeLanguages} languages`}
              description="Paste a snippet, pick a theme, and export a sharp image for a README, docs, or a post."
              preview={<CodePreview />}
            />
            <EditorCard
              href="/store-screenshots"
              title="App Store Screenshots"
              spec={`${STORE_PROFILE.width} × ${STORE_PROFILE.height} · up to ${MAX_STORE_SLIDES} slides`}
              description="Build a matching set of store screenshots with headlines and device frames, sized for App Store Connect."
              preview={<StorePreview />}
            />
          </div>

          <section
            aria-labelledby="image-tools-heading"
            className="mt-3 rounded-2xl bg-card p-5 ring-1 ring-inset ring-border shadow-[var(--card-highlight-shadow)] lg:flex lg:items-center lg:justify-between lg:gap-10"
          >
            <div className="max-w-md">
              <p className={cn(monoClassName, "text-muted-foreground")}>
                No upload · batch
              </p>
              <h2
                id="image-tools-heading"
                className="mt-2 text-lg font-semibold tracking-[-0.02em] text-foreground"
                style={{ fontFamily: INTER }}
              >
                Image Tools
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Quick fixes that run on your device: compress, convert, resize,
                crop, rotate, or remove a background.
              </p>
            </div>
            <ul className="mt-5 flex flex-wrap gap-2 lg:mt-0 lg:justify-end">
              {IMAGE_TOOL_LINKS.map((tool) => (
                <li key={tool.href}>
                  <Link
                    href={tool.href}
                    className="inline-flex h-9 items-center rounded-full px-3.5 text-sm text-muted-foreground ring-1 ring-inset ring-border transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70"
                  >
                    {tool.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={TOOLS_HUB_PATH}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  All tools
                  <ArrowRight01Icon size={14} aria-hidden="true" />
                </Link>
              </li>
            </ul>
          </section>

          <p className="mt-10 text-sm text-muted-foreground">
            First time here?{" "}
            <Link
              href="/landing"
              className="text-foreground underline underline-offset-4"
            >
              See what Screenshot Studio does
            </Link>
            .
          </p>
        </div>
      </main>

      <Footer brandName="Screenshot Studio" />
    </div>
  );
}
