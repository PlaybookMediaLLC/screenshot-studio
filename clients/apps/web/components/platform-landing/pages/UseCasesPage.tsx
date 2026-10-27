import { cn } from '@/lib/utils'
import { AvailabilityPill, HeroStage, LinkCards, MarketingShell, PageHero } from '../blocks'
import { WeekMock } from '../mocks'
import { MUTED, Section, SectionIntro } from '../primitives'

const NEXT = [
  {
    title: 'Launch from a URL',
    body: 'You will paste your product URL, review the profile Shots drafts, and get a first week of posts on a calendar, built from your actual product.',
  },
  {
    title: 'Keep your product visible',
    body: 'Shots will build a weekly plan from your recent changes and history, with no hook repeated from the last thirty days. You will approve the week in one step.',
  },
  {
    title: 'Changes become launches',
    body: 'A merged pull request worth announcing will become a suggested launch for you to review.',
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
          body="Each one starts from a release and ends with posts a teammate approved."
          label="Today"
          lead="Three kinds of launch you can run today,"
          trail="each starting from one release."
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
          body="These are written down in the public roadmap and do not ship today. When they do, they will use the same approval rules."
          label="Next"
          lead="Planned: launches from a URL,"
          trail="a weekly plan, and merged pull requests."
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
        <SectionIntro
          label="By team"
          lead="Read the page for your team:"
          trail="founders, product marketing, or developer tools."
        />
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
