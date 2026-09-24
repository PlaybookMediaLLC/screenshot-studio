import { Metadata } from 'next';
import Link from 'next/link';
import { CodeImageEditorLoader } from '@/components/code-image/CodeImageEditorLoader';
import { OG_DEFAULTS } from '@/lib/seo/metadata';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { PRODUCT_FACTS } from "@/lib/seo/product-facts";

export const metadata: Metadata = {
  title: 'Beautiful Code Screenshots for READMEs',
  description:
    `Turn code into a crisp PNG for your GitHub README, docs, or social posts. ${PRODUCT_FACTS.codeThemes} themes, gradient backgrounds, transparent export at 2x or 4x. Free, no signup, no watermark.`,
  keywords: [
    'code to image',
    'code screenshots for readme',
    'beautiful code screenshots for readme',
    'github readme code image',
    'code snippet screenshot',
    'code screenshot generator',
    'ray.so alternative',
    'carbon alternative',
    'carbon.now.sh alternative',
    'code to png',
    'syntax highlighting screenshot',
    'beautiful code screenshots',
    'code image generator free',
    'share code as image',
    'code snippet generator',
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Code to Image: Beautiful Screenshots',
    description:
      `Turn code into beautiful, shareable images. ${PRODUCT_FACTS.codeThemes} themes, gradients, images, and window frames. Free, no signup.`,
    url: '/code',
  },
  alternates: {
    canonical: '/code',
  },
};

const readmeSteps = [
  'Paste your snippet and pick a theme. Line numbers and a macOS title bar are optional.',
  'Turn the Background switch off for a transparent PNG that sits cleanly on both GitHub light and dark mode, or keep a gradient for a hero image.',
  'Export at 2x so the image stays sharp on high-density screens, then save it in your repository, for example docs/code-example.png.',
  'Reference it from README.md with a relative path and descriptive alt text.',
];

const readmeMarkdown = `![fetchUser returns a typed User from the API](./docs/code-example.png)`;

const readmePicture = `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/code-dark.png">
  <img alt="fetchUser returns a typed User from the API" src="./docs/code-light.png" width="720">
</picture>`;

const faqs = [
  {
    question: 'How do I make a beautiful code screenshot for a README?',
    answer:
      'Paste the snippet into Screenshot Studio, pick a syntax theme, turn the background off for a transparent PNG or keep a gradient, export at 2x, commit the file to your repository, and embed it in README.md with a relative image path and alt text.',
  },
  {
    question: 'Should I use a code image or a fenced code block in my README?',
    answer:
      'Use a fenced code block for anything readers need to copy or search, and an image for a hero example or a visual comparison. Many READMEs use both: the image to catch the eye, the code block right below it.',
  },
  {
    question: 'How do I show a different code image in GitHub dark mode?',
    answer:
      'Export one image with a light theme and one with a dark theme, then wrap them in a picture element with a prefers-color-scheme source. GitHub shows the matching image for each reader.',
  },
  {
    question: 'Is this code to image tool free?',
    answer:
      'Yes. Every theme, background, and export option is free, with no signup and no watermark.',
  },
  {
    question: 'How many syntax themes are included?',
    answer:
      '14 color themes (Midnight, Candy, Sunset, and more), each pairable with its own gradient, one of Screenshot Studio\'s gradient and image backgrounds, or a simple pattern.',
  },
  {
    question: 'Can I export a transparent background?',
    answer:
      'Yes. Turn the Background switch off before exporting and the PNG keeps a transparent backdrop.',
  },
  {
    question: 'What kind of backgrounds can I use?',
    answer:
      'Pick the theme\'s own gradient, one of dozens of gradient presets, a real image background, or a simple grid, dot, or line pattern, all from the Background picker.',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'Screenshot Studio - Code to Image',
      applicationCategory: 'DesignApplication',
      operatingSystem: 'Web Browser',
      description:
        'Free tool that turns code into a beautiful, shareable image with syntax themes, gradient backgrounds, and window styles.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      featureList: [
        '14 syntax highlighting themes',
        'Gradient, image, and pattern backgrounds',
        'Resizable window frame with macOS or no title bar',
        'Transparent background export',
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    },
  ],
};

export default function CodeImagePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <CodeImageEditorLoader />
      <section className="bg-background px-6 pt-16 pb-48">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-3 text-2xl font-semibold tracking-[-0.02em] text-foreground">
            Code to Image Generator
          </h1>
          <p className="mb-10 text-muted-foreground">
            Paste a snippet, pick a theme and background, and export a crisp
            PNG in seconds. No signup, no watermark, everything runs in your
            browser.
          </p>
          <h2 className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground">
            Code Screenshots for Your GitHub README
          </h2>
          <ol className="mb-6 list-decimal space-y-2 pl-5 text-muted-foreground">
            {readmeSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mb-2 text-sm text-muted-foreground">Embed it in README.md:</p>
          <pre className="mb-4 overflow-x-auto rounded-md bg-muted p-4 text-sm text-foreground">
            <code>{readmeMarkdown}</code>
          </pre>
          <p className="mb-2 text-sm text-muted-foreground">
            Or show a separate image in GitHub dark mode:
          </p>
          <pre className="mb-10 overflow-x-auto rounded-md bg-muted p-4 text-sm text-foreground">
            <code>{readmePicture}</code>
          </pre>
          <Accordion type="single" collapsible>
            {faqs.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <p className="mt-10 text-sm text-muted-foreground">
            Coming from another tool? See how it compares to{' '}
            <Link href="/compare/carbon" className="underline">Carbon</Link>
            {' '}and{' '}
            <Link href="/compare/ray-so" className="underline">Ray.so</Link>,
            or explore the{' '}
            <Link href="/features/code-snippets" className="underline">
              code snippet feature
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
