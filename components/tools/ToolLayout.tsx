import Link from "next/link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { TOOLS_HUB_PATH } from "@/lib/seo/tools";
import { cn } from "@/lib/utils";
import { CARD_CLASS, INTER } from "./ui";

/** Centered breadcrumb, H1, and intro shared by every image tool page. */
export function ToolHero({
  name,
  title,
  intro,
}: {
  name: string;
  title: string;
  intro: string;
}) {
  return (
    <header className="mx-auto max-w-3xl text-center">
      <nav aria-label="Breadcrumb">
        <ol className="inline-flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <li>
            <Link href="/" className="transition-colors hover:text-foreground">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={TOOLS_HUB_PATH}
              className="transition-colors hover:text-foreground"
            >
              Image tools
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">
            {name}
          </li>
        </ol>
      </nav>
      <h1
        className="mt-5 text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl"
        style={{ fontFamily: INTER }}
      >
        {title}
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        {intro}
      </p>
    </header>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl"
      style={{ fontFamily: INTER }}
    >
      {children}
    </h2>
  );
}

export function ToolFaq({
  faqs,
}: {
  faqs: { question: string; answer: string }[];
}) {
  return (
    <section>
      <SectionTitle>Frequently asked questions</SectionTitle>
      <Accordion
        type="single"
        collapsible
        className={cn(CARD_CLASS, "mt-5 px-5")}
      >
        {faqs.map((faq) => (
          <AccordionItem
            key={faq.question}
            value={faq.question}
            className="border-border"
          >
            <AccordionTrigger className="text-[15px] hover:no-underline">
              {faq.question}
            </AccordionTrigger>
            <AccordionContent className="leading-relaxed text-muted-foreground">
              {faq.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
