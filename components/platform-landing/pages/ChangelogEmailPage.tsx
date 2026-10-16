import { CHANNEL_RULES } from '@/lib/launch/guards'
import {
  FaqBlock,
  HeroStage,
  LinkCards,
  MarketingShell,
  PageHero,
  SplitFeature,
  TileGrid,
} from '../blocks'
import { ChangelogMock, PostCard } from '../mocks'
import { Section, SectionIntro } from '../primitives'

/** /use-cases/changelog-and-email: release notes that reach the changelog and the inbox. */
export function ChangelogEmailPage() {
  const changelog = CHANNEL_RULES.changelog
  const email = CHANNEL_RULES.email
  return (
    <MarketingShell finale={{ lead: 'Release notes', trail: 'people actually read.' }}>
      <PageHero
        body="Every release gets a changelog entry and an announcement email, drafted from the same cited spec as the social posts. Email goes only to people who asked for it, once each."
        eyebrow={{ href: '/use-cases', label: 'Changelog and email', parent: 'Use cases' }}
        lead="Release notes"
        location="changelog_email_hero"
        trail="that reach people."
      >
        <HeroStage variant={2}>
          <div className="grid w-full max-w-[960px] gap-4 md:grid-cols-2">
            <ChangelogMock />
            <PostCard
              body={
                'Set a schedule once and Acme sends the invoice every cycle.\n\nPick monthly, quarterly, or yearly, and pause any time from the invoice page. One schedule per invoice for now.'
              }
              channel="email"
              claims={['whatChanged.0', 'limitations.0']}
              title="Recurring invoices are here"
            />
          </div>
        </HeroStage>
      </PageHero>

      <Section>
        <SectionIntro
          body="The changelog is the record. It says what changed, why it matters, and what it does not do yet, because the spec has a limitations section and the copy cites it."
          label="Changelog"
          lead="An honest record"
          trail="of what shipped."
        />
        <div className="mt-24">
          <SplitFeature
            body={`A heading up to ${changelog.title.max} characters and an entry up to ${changelog.bodyMax.toLocaleString('en-US')}. Written to the spec, so it agrees with every post about the same release.`}
            bullets={[
              'What changed, from the spec',
              'Why it matters, from the brief',
              'Limitations, stated plainly',
              'No hype words, no unsupported claims',
            ]}
            index={0}
            title="The entry"
          >
            <ChangelogMock />
          </SplitFeature>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body={`A subject up to ${email.title.max} characters and a body up to ${email.bodyMax.toLocaleString('en-US')}, rendered as HTML and plain text from one template so the two never drift.`}
          label="Email"
          lead="To people who asked."
          trail="Once each."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'consent · per organization',
                title: 'Consent first',
                body: 'Recipients are resolved at send time, so a late unsubscribe is honored. Leaving one company’s announcements never silences another’s.',
              },
              {
                snippet: 'POST + GET unsubscribe',
                title: 'One-click unsubscribe',
                body: 'The one-click unsubscribe Gmail and Yahoo require, plus a footer link for every other client, signed so nobody can unsubscribe someone else.',
              },
              {
                snippet: 'unique (message, email)',
                title: 'Exactly once',
                body: 'Each address gets one row under a unique constraint. A retry after a partial failure reaches only the people who have not received it.',
              },
              {
                snippet: 'suppressed ≠ unsubscribed',
                title: 'Bounces respected',
                body: 'Hard bounces and complaints stop sending even if the person never unsubscribed.',
              },
              {
                snippet: 'approved only',
                title: 'Approved releases only',
                body: 'Only approved release documents can be announced, and an empty audience is refused rather than silently accepted.',
              },
              {
                snippet: 'markdown → text',
                title: 'Inert content',
                body: 'Release bodies are flattened to escaped text, so nothing in a release can run in an inbox.',
              },
            ]}
          />
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Is this a newsletter tool?',
            a: 'No. It announces releases to people who opted in. Drip campaigns and newsletters are out of scope.',
          },
          {
            q: 'Can I import my subscriber list?',
            a: 'Yes, with our help during early access. Addresses are normalized on import, and re-importing never brings back someone who unsubscribed.',
          },
          {
            q: 'Is release email available now?',
            a: 'Delivery is built and running. It is part of early access while the authoring screens are finished.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards
            paths={[
              '/product/publishing',
              '/use-cases/feature-launches',
              '/solutions/developer-tools',
            ]}
          />
        </div>
      </Section>
    </MarketingShell>
  )
}
