import { cn } from '@/lib/utils'
import { LinkCards, MarketingShell, PageHero } from '../blocks'
import { GITHUB_URL } from '../LandingNav'
import { MONO, MUTED, Section, SectionIntro } from '../primitives'

const RFC = (file: string) => `${GITHUB_URL}/blob/main/docs/${file}`

const PRINCIPLES = [
  {
    title: 'Freeze the promise',
    quote: 'Do not promise "AI runs your entire marketing department."',
    body: 'The promise is narrower and better: give us what you shipped, and we turn it into polished, ready-to-publish content. Everything else has to earn its way in.',
    source: 'RFC 009',
    href: RFC('rfcs/009-marketing-platform-thesis.md'),
  },
  {
    title: 'Build inside out',
    quote:
      'If we reverse this order and start with the agent, we debug hallucinated workflows instead of building a product.',
    body: 'Deterministic primitives first, then recipes, then an agent, then autonomy. Each layer calls only what the layer below has proven.',
    source: 'RFC 009',
    href: RFC('rfcs/009-marketing-platform-thesis.md'),
  },
  {
    title: 'Recipes before agents',
    quote: 'A recipe that fails names its failing step.',
    body: 'Control flow is code. Models fill in text at fixed points with validated output, so a bad run points at one step instead of a shrug.',
    source: 'RFC 015',
    href: RFC('rfcs/015-feature-launch-recipe.md'),
  },
  {
    title: 'Objects, not transcripts',
    quote: 'We do not store campaigns as conversation.messages[]. That is a trap.',
    body: 'A campaign is a database object. Chat is one way to change it, along with a form, an API call, or a scheduled job.',
    source: 'RFC 014',
    href: RFC('rfcs/014-structured-marketing-objects.md'),
  },
  {
    title: 'The workspace over chat',
    quote: 'AI manipulates the workspace. The workspace is not merely the output of AI.',
    body: 'Every action available through chat is available without it. The copilot is an accelerant, not the product.',
    source: 'RFC 018',
    href: RFC('rfcs/018-campaign-workspace.md'),
  },
  {
    title: 'Approval is structure',
    quote: 'Approval is the human gate the whole platform rests on.',
    body: 'Approval is a server-side state machine that no tool call can skip and no API key can pass.',
    source: 'RFC 019',
    href: RFC('rfcs/019-approval-workflow.md'),
  },
  {
    title: 'Safe tools',
    quote: 'The model decides what to do. The application decides how it is done safely.',
    body: 'Agents get domain capabilities, not infrastructure. No SQL, no arbitrary HTTP, no credentials, and no way to name another workspace.',
    source: 'RFC 016',
    href: RFC('rfcs/016-ai-sdk-marketing-tools.md'),
  },
  {
    title: 'Cite or ask',
    quote:
      'A claim citing a source that does not exist, or citing nothing, is removed and turned into an open question.',
    body: 'A launch that invents a benchmark costs more than a launch that asks one question.',
    source: 'Launch intelligence',
    href: RFC('launch-intelligence.md'),
  },
  {
    title: 'Manual beats scraped',
    quote: 'A user-typed description always wins over extracted content.',
    body: 'Automation fills empty fields. It never overwrites what a person wrote.',
    source: 'RFC 032',
    href: RFC('rfcs/032-background-onboarding-agent.md'),
  },
  {
    title: 'Degrade into something useful',
    quote: 'The floor is that a founder always reaches a workspace with something to act on.',
    body: 'Copy without a creative beats nothing. A form beats a spinner. Partial results are kept and labeled.',
    source: 'RFC 021',
    href: RFC('rfcs/021-core-workflows.md'),
  },
  {
    title: 'Late beats twice',
    quote: 'Duplicate announcements to customers are worse than late ones.',
    body: 'When delivery is uncertain, a person decides. Nothing is blindly sent again.',
    source: 'Customer email and release broadcast',
    href: RFC('email-and-broadcast.md'),
  },
  {
    title: 'Autonomy is earned',
    quote: 'The progression Manual → Copilot → Autopilot replaces any jump directly into autonomy.',
    body: 'Users choose their level. A mode never widens what a role is allowed to do.',
    source: 'RFC 031',
    href: RFC('rfcs/031-autonomy-modes.md'),
  },
  {
    title: 'Measure the return',
    quote: 'Return rate is the one that matters.',
    body: 'A team that runs one launch and never comes back received a demo, not a product.',
    source: 'RFC 021',
    href: RFC('rfcs/021-core-workflows.md'),
  },
]

/** /principles: the decisions behind the platform, quoted from its RFCs. */
export function PrinciplesPage() {
  return (
    <MarketingShell finale={{ lead: 'Built on purpose.', trail: 'Written down in public.' }}>
      <PageHero
        body="Every part of Screenshot Studio was argued out in a written RFC before it was built. These are the decisions that shape the product, quoted from the documents that made them."
        eyebrow={{ label: 'Principles' }}
        lead="Every decision,"
        location="principles_hero"
        primary={{ href: `${GITHUB_URL}/tree/main/docs/rfcs`, label: 'Read the RFCs' }}
        secondary={{ href: '/roadmap', label: 'See the roadmap' }}
        trail="written down first."
      />

      <Section>
        <SectionIntro
          body="Thirteen commitments. Each links to the document it comes from."
          label="Principles"
          lead="How we build it."
          trail="And why."
        />
        <ol className="mt-24 border-t border-[#212121]">
          {PRINCIPLES.map((principle, index) => (
            <li
              className="grid gap-6 border-b border-[#212121] py-12 lg:grid-cols-[80px_1fr_1.3fr] lg:gap-12"
              key={principle.title}
            >
              <span className={cn(MONO, 'text-[13px]', MUTED)}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h2 className="text-[26px] leading-[1.2] tracking-[-0.02em] text-white">
                  {principle.title}
                </h2>
                <p className={cn('mt-3 max-w-[420px] text-base leading-[1.6]', MUTED)}>
                  {principle.body}
                </p>
              </div>
              <figure>
                <blockquote className="text-balance text-[22px] leading-[1.4] tracking-[-0.015em] text-white/90">
                  “{principle.quote}”
                </blockquote>
                <figcaption className="mt-4">
                  <a
                    className={cn(
                      'text-sm underline-offset-4 hover:text-white hover:underline',
                      MUTED
                    )}
                    href={principle.href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {principle.source}
                  </a>
                </figcaption>
              </figure>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionIntro label="Related" lead="See the result." trail="Or what comes next." />
        <div className="mt-24">
          <LinkCards paths={['/product', '/roadmap', '/product/guardrails']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
