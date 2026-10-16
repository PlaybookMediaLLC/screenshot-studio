import Link from 'next/link'
import {
  Calendar03Icon,
  Database01Icon,
  FlashIcon,
  Layers01Icon,
  Mail01Icon,
  SparklesIcon,
} from 'hugeicons-react'
import { PRODUCT_FACTS } from '@/lib/seo/product-facts'
import { cn } from '@/lib/utils'
import { FaqBlock, MarketingShell, PageHero, TileGrid } from '../blocks'
import { GITHUB_URL } from '../LandingNav'
import { MUTED, Section, SectionIntro } from '../primitives'
import { PlanCards, PlanComparison } from '../pricing'

const FREE_TOOLS = [
  { href: '/free-screenshot-editor', label: 'Screenshot editor' },
  { href: '/mockup-generator', label: 'Mockup generator' },
  { href: '/store-screenshots', label: 'App Store screenshots' },
  { href: '/code', label: 'Code to image' },
  { href: '/tweet', label: 'Tweet to image' },
  { href: '/remove-background', label: 'Background remover' },
  { href: '/compress-video', label: 'Video compressor' },
  { href: '/tools', label: 'Image tools' },
]

/** /pricing: plan cards, the full comparison, what each limit counts, and billing questions. */
export function PricingPage() {
  return (
    <MarketingShell finale={{ lead: 'Start on Free.', trail: 'Upgrade when you ship more.' }}>
      <PageHero
        body="Every workspace starts on Free with the editor, the API, roles, and approval. Paid plans raise every limit. Enterprise adds the controls a security review asks for."
        eyebrow={{ label: 'Pricing' }}
        lead="Start free."
        location="pricing_hero"
        secondary={{ href: '/contact', label: 'Contact sales' }}
        trail="Grow into the platform."
      >
        <PlanCards location="pricing_cards" />
      </PageHero>

      <Section>
        <SectionIntro
          body="Read from the same entitlement code that enforces them, so this table cannot promise more than the product delivers."
          label="Compare"
          lead="Every limit,"
          trail="side by side."
        />
        <div className="mt-24">
          <PlanComparison />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="A few numbers decide what a plan can do. None of them count the editor, which stays free."
          label="What counts"
          lead="Simple limits."
          trail="No surprise meters."
        />
        <div className="mt-24">
          <TileGrid
            columns={2}
            items={[
              {
                icon: SparklesIcon,
                title: 'AI credits',
                body: 'One credit is one cent of model cost. Every model call is charged what it actually cost, so a short copilot edit uses a few credits and a full launch about 430. A workspace out of credits is refused before its next call.',
              },
              {
                icon: Calendar03Icon,
                title: 'Scheduled posts',
                body: 'Each post scheduled to a social channel counts once. A schedule that fails to save does not count.',
              },
              {
                icon: Mail01Icon,
                title: 'Release emails',
                body: 'Each recipient of a release announcement counts once. A send that is refused or fails to queue does not count.',
              },
              {
                icon: FlashIcon,
                title: 'API writes per minute',
                body: 'Creates and updates through the REST API, per workspace. Reads are not counted. Launch AI actions also have their own per-minute limit, so a burst of clicks cannot spend a month in seconds.',
              },
              {
                icon: Layers01Icon,
                title: 'Concurrent jobs',
                body: 'How much background work a workspace can run at the same time: renders, captures, and generation runs.',
              },
              {
                icon: Database01Icon,
                title: 'Asset storage',
                body: 'Designs and captures saved to the workspace, kept in private, organization-scoped storage. Uploads are write-once and downloads use short-lived signed links.',
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-8">
          <div>
            <p className="text-[26px] tracking-[-0.02em] text-white sm:text-[30px]">
              Free, on every plan
            </p>
            <p className={cn('mt-4 max-w-[480px] text-lg leading-[1.55]', MUTED)}>
              The {PRODUCT_FACTS.license} screenshot editor and its tools run in your browser on a
              free workspace, with no watermark.
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-px overflow-hidden border border-[#212121] bg-[#212121]">
            {FREE_TOOLS.map((tool) => (
              <li key={tool.href}>
                <Link
                  className="block bg-[#090909] px-5 py-5 text-[15px] text-white/85 transition-colors hover:bg-[#111] hover:text-white"
                  href={tool.href}
                >
                  {tool.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Is there a free plan?',
            a: 'Yes. Every workspace starts on Free and stays there until you choose otherwise. A workspace without a billing record is treated as Free.',
          },
          {
            q: 'How do I buy Pro or Business?',
            a: 'A workspace admin chooses Upgrade on the plan and pays through Stripe Checkout; the plan applies as soon as Stripe confirms the subscription. Change plans, update cards, or cancel from the billing portal. Cancelling returns the workspace to Free with its data intact.',
          },
          {
            q: 'What happens when I reach a limit?',
            a: 'The next model call, post, or email is refused with a clear error. AI credits, posts, and emails reset on the first of each month (UTC); API writes reset every minute. To keep going before the reset, buy an extra launch: 500 AI credits for $29, spent after the allowance and never expiring.',
          },
          {
            q: 'What if a payment fails?',
            a: 'Stripe retries the card, and a past-due workspace keeps its plan for 14 days. After that, plan features close until billing is resolved. Your data stays where it is.',
          },
          {
            q: 'Which plan includes SSO and SCIM?',
            a: (
              <>
                Enterprise, along with signed audit drains, longer audit retention, and legal hold.
                See{' '}
                <Link className="text-white underline-offset-4 hover:underline" href="/enterprise">
                  Enterprise
                </Link>
                .
              </>
            ),
          },
          {
            q: 'Can I self-host instead?',
            a: (
              <>
                Yes. The platform ships Docker images and a Helm chart in the{' '}
                <a
                  className="text-white underline-offset-4 hover:underline"
                  href={GITHUB_URL}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  open-source repository
                </a>
                .
              </>
            ),
          },
        ]}
      />
    </MarketingShell>
  )
}
