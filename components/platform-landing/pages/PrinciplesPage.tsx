import { cn } from '@/lib/utils'
import { LinkCards, MarketingShell, PageHero } from '../blocks'
import { MONO, MUTED, Section, SectionIntro } from '../primitives'

const PRINCIPLES = [
  {
    title: 'Freeze the promise',
    quote: 'Do not promise "AI runs your entire marketing department."',
    body: 'The promise is narrower and better: give us what you shipped, and we turn it into polished, ready-to-publish content. Everything else has to earn its way in.',
    source: 'Platform thesis',
  },
  {
    title: 'Build inside out',
    quote:
      'If we reverse this order and start with the agent, we debug hallucinated workflows instead of building a product.',
    body: 'Deterministic primitives first, then recipes, then an agent, then autonomy. Each layer calls only what the layer below has proven.',
    source: 'Platform thesis',
  },
  {
    title: 'Recipes before agents',
    quote: 'A recipe that fails names its failing step.',
    body: 'Control flow is code. Models fill in text at fixed points with validated output, so a bad run points at one step instead of a shrug.',
    source: 'Launch recipe',
  },
  {
    title: 'Objects, not transcripts',
    quote: 'We do not store campaigns as conversation.messages[]. That is a trap.',
    body: 'A campaign is a database object. Chat is one way to change it, along with a form, an API call, or a scheduled job.',
    source: 'Marketing objects',
  },
  {
    title: 'The workspace over chat',
    quote: 'AI manipulates the workspace. The workspace is not merely the output of AI.',
    body: 'Every action available through chat is available without it. The copilot is an accelerant, not the product.',
    source: 'Campaign workspace',
  },
  {
    title: 'Approval is structure',
    quote: 'Approval is the human gate the whole platform rests on.',
    body: 'Approval is a server-side state machine that no tool call can skip and no API key can pass.',
    source: 'Approval workflow',
  },
  {
    title: 'Safe tools',
    quote: 'The model decides what to do. The application decides how it is done safely.',
    body: 'Agents get domain capabilities, not infrastructure. No SQL, no arbitrary HTTP, no credentials, and no way to name another workspace.',
    source: 'Marketing tools',
  },
  {
    title: 'Cite or ask',
    quote:
      'A claim citing a source that does not exist, or citing nothing, is removed and turned into an open question.',
    body: 'A launch that invents a benchmark costs more than a launch that asks one question.',
    source: 'Launch intelligence',
  },
  {
    title: 'Manual beats scraped',
    quote: 'A user-typed description always wins over extracted content.',
    body: 'Automation fills empty fields. It never overwrites what a person wrote.',
    source: 'Onboarding agent',
  },
  {
    title: 'Degrade into something useful',
    quote: 'The floor is that a founder always reaches a workspace with something to act on.',
    body: 'Copy without a creative beats nothing. A form beats a spinner. Partial results are kept and labeled.',
    source: 'Core workflows',
  },
  {
    title: 'Late beats twice',
    quote: 'Duplicate announcements to customers are worse than late ones.',
    body: 'When delivery is uncertain, a person decides. Nothing is blindly sent again.',
    source: 'Customer email and release broadcast',
  },
  {
    title: 'Autonomy is earned',
    quote: 'The progression Manual → Copilot → Autopilot replaces any jump directly into autonomy.',
    body: 'Users choose their level. A mode never widens what a role is allowed to do.',
    source: 'Autonomy modes',
  },
  {
    title: 'Measure the return',
    quote: 'Return rate is the one that matters.',
    body: 'A team that runs one launch and never comes back received a demo, not a product.',
    source: 'Core workflows',
  },
]

/** /principles: the decisions behind the platform, and the reasons for them. */
export function PrinciplesPage() {
  return (
    <MarketingShell finale={{ lead: 'Built on purpose.', trail: 'Written down in public.' }}>
      <PageHero
        body="Every part of Shots was argued out in writing before it was built. These are the decisions that shape the product."
        eyebrow={{ label: 'Principles' }}
        lead="Every decision,"
        location="principles_hero"
        primary={{ href: '/sign-up', label: 'Get started' }}
        secondary={{ href: '/roadmap', label: 'See the roadmap' }}
        trail="written down first."
      />

      <Section>
        <SectionIntro
          body="Thirteen commitments that every release is held to."
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
                <figcaption className={cn('mt-4 text-sm', MUTED)}>{principle.source}</figcaption>
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
