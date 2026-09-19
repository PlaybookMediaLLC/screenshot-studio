import { Metadata } from 'next';
import Link from 'next/link';
import { Navigation } from '@/components/landing/Navigation';
import { Footer } from '@/components/landing/Footer';
import { RemoveBackgroundLoader } from '@/components/remove-background/RemoveBackgroundLoader';
import { OG_DEFAULTS, SITE_URL } from '@/lib/seo/metadata';
import { TOOLS_HUB_PATH } from '@/lib/seo/tools';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export const metadata: Metadata = {
  title: 'Remove Background from Image: Free, Private, No Upload',
  description:
    'Remove an image background in your browser and download a transparent PNG. Runs on your device with WebGPU. Free, no signup, no watermark.',
  keywords: [
    'remove background',
    'remove background from image',
    'background remover',
    'transparent background maker',
    'remove bg free',
    'remove.bg alternative',
    'background eraser online',
    'make background transparent',
    'cut out image',
    'private background remover',
    'background remover no upload',
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Remove Background from Image: Free, Private, No Upload',
    description:
      'Remove an image background on your device and download a transparent PNG. Free, no signup, no watermark.',
    url: '/remove-background',
  },
  alternates: {
    canonical: '/remove-background',
  },
};

const faqs = [
  {
    question: 'Is my image uploaded anywhere?',
    answer:
      'No. The image is decoded, processed, and turned into a PNG inside your browser tab. The only network request is a one-time download of the AI model from Hugging Face, and that request contains no image data.',
  },
  {
    question: 'Why does the first image take longer?',
    answer:
      'The first time you use it, your browser downloads the BiRefNet-lite model (about 98 MB with WebGPU, 192 MB without). It is cached afterwards, so later images start in a second or two, even offline.',
  },
  {
    question: 'What is the difference between crisp and soft edges?',
    answer:
      'Crisp edges clean up faint haze around the subject, which suits products, logos, and portraits. Soft edges keep the model\'s partial transparency, which is better for hair, fur, and motion blur. Switching between them is instant and does not rerun the model.',
  },
  {
    question: 'Which browsers and images are supported?',
    answer:
      'Recent Chrome, Edge, Firefox, and Safari. Browsers with WebGPU run on the graphics card; others fall back to WebAssembly on the CPU. PNG, JPG, WebP, and AVIF images up to 50 MB are supported.',
  },
  {
    question: 'Is it free, and is there a watermark?',
    answer:
      'It is completely free with no signup, no daily limit, and no watermark. The output keeps the full resolution of your original image.',
  },
];

const PAGE_URL = `${SITE_URL}/remove-background`;

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      '@id': `${PAGE_URL}#application`,
      name: 'Screenshot Studio - Remove Background',
      url: PAGE_URL,
      applicationCategory: 'DesignApplication',
      applicationSubCategory: 'Background Remover',
      operatingSystem: 'Any (Web Browser)',
      description:
        'Free background remover that runs on your device and exports a transparent PNG without uploading the image.',
      isAccessibleForFree: true,
      publisher: {
        '@id': `${SITE_URL}/#organization`,
      },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      featureList: [
        'On-device AI background removal with BiRefNet-lite',
        'WebGPU acceleration with WebAssembly fallback',
        'Transparent PNG at original resolution',
        'Before and after comparison slider',
        'No upload, no signup, no watermark',
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${PAGE_URL}#faq`,
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${PAGE_URL}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Image Tools',
          item: `${SITE_URL}${TOOLS_HUB_PATH}`,
        },
        { '@type': 'ListItem', position: 3, name: 'Remove Background', item: PAGE_URL },
      ],
    },
  ],
};

export default function RemoveBackgroundPage() {
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
            <nav aria-label="Breadcrumb" className="mb-4">
              <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <li>
                  <Link href="/" className="hover:text-foreground">
                    Home
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={TOOLS_HUB_PATH} className="hover:text-foreground">
                    Image Tools
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li className="text-foreground">Remove Background</li>
              </ol>
            </nav>

            <h1 className="mb-3 text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
              Remove Background from Image
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground">
              Drop in a photo and get a transparent PNG back in seconds. The AI
              model runs on your own device, so your image is never uploaded.
              No signup, no watermark.
            </p>
          </div>
        </section>

        <section className="px-6 pb-16">
          <RemoveBackgroundLoader />
        </section>

        <section className="border-t border-border px-6 py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-6 text-xl font-semibold tracking-[-0.01em] text-foreground">
              Frequently asked questions
            </h2>
            <Accordion type="single" collapsible>
              {faqs.map((faq) => (
                <AccordionItem key={faq.question} value={faq.question}>
                  <AccordionTrigger>{faq.question}</AccordionTrigger>
                  <AccordionContent>{faq.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            <p className="mt-12 text-sm text-muted-foreground">
              Coming from remove.bg? See{' '}
              <Link href="/compare/remove-bg" className="underline">how it compares</Link>
              , or read more about the{' '}
              <Link href="/features/background-remover" className="underline">
                background remover feature
              </Link>
              . Want to put your cutout on a gradient or in a mockup? Open the{' '}
              <Link href="/" className="underline">Screenshot Studio editor</Link>
              , or browse{' '}
              <Link href={TOOLS_HUB_PATH} className="underline">every image tool</Link>
              .
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
