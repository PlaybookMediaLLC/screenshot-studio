import { cn } from '@/lib/utils'
import { AvailabilityPill, HeroStage, LinkCards, MarketingShell, PageHero } from '../blocks'
import { WeekMock } from '../mocks'
import { MUTED, Section, SectionIntro } from '../primitives'

const NEXT = [
  {
    title: 'Launch from a URL',
    body: 'Paste your product URL, review a profile in seconds, and get your first seven posts on a calendar, built from your actual application.',
  },
  {
    title: 'Keep your product visible',
    body: 'A weekly plan from your recent changes and history, with no hook repeated from the last thirty days. One approval for the week.',
  },
  {
    title: 'Changes become launches',
    body: 'A merged pull request worth announcing becomes a suggested campaign. Never an automatic post.',
  },
]

/** /use-cases: the jobs teams hire Shots for, shipped and next. */
export function UseCasesPage() {
  return (
    <MarketingShell>
      <PageHero
        body="One workspace for the moments a software team has to explain what it built: a new feature, a whole product, and the release notes that reach the changelog and the inbox."
        eyebrow={{ label: 'Use cases' }}
        lead="What teams launch"
        location="use_cases_hero"
        trail="with Shots."
      >
        <HeroStage>
          <WeekMock />
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Each one starts from a release and ends with posts a person approved."
          label="Today"
          lead="Three launches."
          trail="One workflow."
        />
        <div className="mt-24">
          <LinkCards
            paths={[
              '/use-cases/feature-launches',
              '/use-cases/product-launches',
              '/use-cases/changelog-and-email',
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="These are designed and written down in the public roadmap. They build on the same objects and the same approval gate."
          label="Next"
          lead="From your release"
          trail="to your whole week."
        />
        <ul className="mt-24 grid gap-4 md:grid-cols-3">
          {NEXT.map((item) => (
            <li className="bg-[#111] p-8" key={item.title}>
              <AvailabilityPill status="Planned" />
              <h3 className="mt-10 text-[22px] tracking-[-0.015em] text-white">{item.title}</h3>
              <p className={cn('mt-3 text-base leading-[1.6]', MUTED)}>{item.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <SectionIntro label="By team" lead="Who it is for." trail="Pick your seat." />
        <div className="mt-24">
          <LinkCards
            paths={[
              '/solutions/founders',
              '/solutions/product-marketing',
              '/solutions/developer-tools',
            ]}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
