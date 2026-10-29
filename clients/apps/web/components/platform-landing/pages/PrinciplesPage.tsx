import { cn } from '@/lib/utils'
import { LinkCards, MarketingShell, PageHero } from '../blocks'
import { MONO, MUTED, Section, SectionIntro } from '../primitives'

const PRINCIPLES = [
  {
    title: 'Keep the promise narrow',
    rule: 'Give us what you shipped, and we turn it into content ready to publish.',
    body: "Shots doesn't claim to run your whole marketing department. Every new feature has to serve that one promise.",
  },
  {
    title: 'Build the manual tools first',
    rule: 'Manual tools first, then step-by-step workflows, then the AI.',
    body: 'Each layer uses only what the layer below already does reliably. Starting with the AI would mean debugging workflows it made up.',
  },
  {
    title: 'Fixed steps before the AI',
    rule: 'When a workflow fails, it tells you which step failed.',
    body: 'The order of steps is written in code. The AI fills in text at set points, and its output is checked.',
  },
  {
    title: 'Records over chat history',
    rule: 'A launch is saved as records, so you can change one piece without redoing the rest.',
    body: 'Chat is one way to change a launch. A form, an API call, or a scheduled job can change it too.',
  },
  {
    title: 'The workspace comes first',
    rule: 'Everything you can do in chat, you can also do in the workspace.',
    body: 'The AI edits the same workspace you do, and you can do all of its work by hand.',
  },
  {
    title: 'Approval is enforced',
    rule: "Every post needs a teammate's approval, checked on the server.",
    body: 'No AI action can skip approval, and no API key can give it.',
  },
  {
    title: 'Safe tools',
    rule: 'The AI suggests what to do. Shots decides how it runs safely.',
    body: "The AI gets marketing tools. It can't query the database, make arbitrary web requests, hold credentials, or name another workspace.",
  },
  {
    title: 'Cite or ask',
    rule: 'A claim that cites nothing, or a missing source, is removed and becomes an open question.',
    body: 'Asking you one question costs less than a launch that invents a benchmark.',
  },
  {
    title: 'What you type wins',
    rule: 'A description you typed always wins over text Shots extracted.',
    body: 'Automation fills empty fields. It never overwrites what you wrote.',
  },
  {
    title: 'Always leave something useful',
    rule: 'If a step fails, you still reach a workspace with something to act on.',
    body: 'Posts without a visual are kept. Partial results are saved and labeled.',
  },
  {
    title: 'Late beats twice',
    rule: 'A duplicate post or email is worse than a late one.',
    body: 'When delivery is uncertain, a teammate decides. Shots does not resend on its own.',
  },
  {
    title: 'Automation is earned',
    rule: 'You move from Manual to Copilot to Autopilot one step at a time.',
    body: 'You choose the level. A mode never gives a role more permissions.',
  },
  {
    title: 'Measure whether teams come back',
    rule: 'The number that matters is how many teams return for their next launch.',
    body: "If a team runs one launch and leaves, Shots hasn't done its job.",
  },
]

/** /principles: the decisions behind the platform, and the reasons for them. */
export function PrinciplesPage() {
  return (
    <MarketingShell
      finale={{ lead: 'Try Shots on your next release', trail: 'and hold us to these rules.' }}
    >
      <PageHero
        body="We argued out each part of Shots in writing before building it. These are the decisions that shape the product."
        eyebrow={{ label: 'Principles' }}
        lead="The rules we build Shots by,"
        location="principles_hero"
        secondary={{ href: '/roadmap', label: 'See the roadmap' }}
        trail="decided before we wrote the code."
      />

      <Section>
        <SectionIntro
          label="Principles"
          lead={`${PRINCIPLES.length} rules every release is held to,`}
          trail="each with the reason behind it."
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
              <p className="text-balance text-[22px] leading-[1.4] tracking-[-0.015em] text-white/90">
                {principle.rule}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionIntro
          label="Related"
          lead="See these rules in the product,"
          trail="on the roadmap, and in the guardrails."
        />
        <div className="mt-24">
          <LinkCards paths={['/product', '/roadmap', '/product/guardrails']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
