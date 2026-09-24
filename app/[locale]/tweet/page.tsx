import { Metadata } from 'next';
import Link from 'next/link';
import { TweetImageEditorLoader } from '@/components/tweet-image/TweetImageEditorLoader';
import { OG_DEFAULTS } from '@/lib/seo/metadata';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export const metadata: Metadata = {
  title: 'Tweet to Image: Turn Posts on X into Images',
  description:
    'Paste a link to a post on X and download it as a clean PNG. Light or dark card, gradient or transparent background, export at 2x or 4x. Free, no signup, no watermark.',
  keywords: [
    'tweet to image',
    'tweet screenshot',
    'tweet screenshot generator',
    'x post to image',
    'twitter post screenshot',
    'tweet to png',
    'save tweet as image',
    'tweet image generator free',
    'share tweet as image',
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Tweet to Image: Clean Screenshots of Posts on X',
    description:
      'Paste a post link from X, pick light or dark, add a background, and export a PNG. Free, no signup.',
    url: '/tweet',
  },
  alternates: {
    canonical: '/tweet',
  },
};

const steps = [
  'Copy the link to a post on X, for example x.com/user/status/123, and paste it into the box above the card.',
  'Pick a light or dark card to match where the image will go.',
  'Keep a gradient background for social posts and slides, or turn Background off for a transparent PNG.',
  'Export at 2x or 4x, or copy the image straight to your clipboard.',
];

const faqs = [
  {
    question: 'How do I turn a tweet into an image?',
    answer:
      'Copy the post link from X, paste it into Screenshot Studio, choose a light or dark card and a background, then export a PNG or copy the image to your clipboard.',
  },
  {
    question: 'Does it work with x.com and twitter.com links?',
    answer:
      'Yes. Links from x.com, twitter.com, and mobile.twitter.com all work, and so does a bare post ID.',
  },
  {
    question: 'Why does a post fail to load?',
    answer:
      'Only public posts can be loaded. Posts that were deleted, belong to a protected account, or come from a suspended account are not available.',
  },
  {
    question: 'Are photos in the post included?',
    answer:
      'Yes. Up to four photos from the post are shown in the card. Videos and GIFs are left out, so the image stays a still snapshot of the text.',
  },
  {
    question: 'Can I export with a transparent background?',
    answer:
      'Yes. Turn the Background switch off before exporting and the PNG keeps only the card, with rounded corners and a transparent backdrop.',
  },
  {
    question: 'Is it free?',
    answer:
      'Yes. Every card style, background, and export size is free, with no signup and no watermark.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'Screenshot Studio - Tweet to Image',
      applicationCategory: 'DesignApplication',
      operatingSystem: 'Web Browser',
      description:
        'Free tool that turns a post on X into a clean, shareable image with light or dark cards and gradient backgrounds.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      featureList: [
        'Load any public post from an x.com or twitter.com link',
        'Light and dark card styles',
        'Gradient, image, and pattern backgrounds',
        'Transparent background export at 2x or 4x',
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

export default function TweetImagePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <TweetImageEditorLoader />
      <section className="bg-background px-6 pt-16 pb-48">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-3 text-2xl font-semibold tracking-[-0.02em] text-foreground">
            Tweet to Image Generator
          </h1>
          <p className="mb-10 text-muted-foreground">
            Paste a link to any public post on X and get a clean image of it,
            ready for slides, docs, newsletters, or another thread. No signup,
            no watermark.
          </p>
          <h2 className="mb-3 text-xl font-semibold tracking-[-0.02em] text-foreground">
            How to Save a Post from X as an Image
          </h2>
          <ol className="mb-10 list-decimal space-y-2 pl-5 text-muted-foreground">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Accordion type="single" collapsible>
            {faqs.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <p className="mt-10 text-sm text-muted-foreground">
            Want the post inside a device mockup or next to a screenshot? Open the{' '}
            <Link href="/editor" className="underline">screenshot editor</Link>
            , or turn a snippet into an image with{' '}
            <Link href="/code" className="underline">code to image</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
