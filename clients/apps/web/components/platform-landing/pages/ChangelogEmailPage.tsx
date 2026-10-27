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
    <MarketingShell
      finale={{ lead: 'Send your next changelog', trail: 'to the people who asked for it.' }}
    >
      <PageHero
        body="Both are drafted from the same cited launch brief as your social posts. The release email goes only to people who opted in, once each."
        eyebrow={{ href: '/use-cases', label: 'Changelog and email', parent: 'Use cases' }}
        lead="A changelog entry and a release email"
        location="changelog_email_hero"
        trail="for every release you ship."
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
          body="It covers what changed and why it matters. It also lists limitations, because the launch brief has a limitations section and the entry cites it."
          label="Changelog"
          lead="The changelog says what changed"
          trail="and what it doesn't do yet."
        />
        <div className="mt-24">
          <SplitFeature
            body={`A heading up to ${changelog.title.max} characters and an entry up to ${changelog.bodyMax.toLocaleString('en-US')}. Written to the launch brief, so it agrees with every post about the same release.`}
            bullets={[
              'What changed, from the launch brief',
              'Why it matters, from the release',
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
          body={`A subject up to ${email.title.max} characters and a body up to ${email.bodyMax.toLocaleString('en-US')}. One template renders both the HTML and the plain text, so the two match.`}
          label="Email"
          lead="Each subscriber who opted in"
          trail="gets the email once."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: 'consent · per workspace',
                title: 'Consent first',
                body: "Recipients are looked up at send time, so a late unsubscribe is honored. Unsubscribing from one company's emails doesn't affect another's.",
              },
              {
                snippet: 'POST + GET unsubscribe',
                title: 'One-click unsubscribe',
                body: 'The one-click unsubscribe Gmail and Yahoo require, plus a footer link for every other client. Links are signed, so nobody can unsubscribe someone else.',
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
                body: 'Shots emails only approved releases, and refuses to send to an empty audience.',
              },
              {
                snippet: 'markdown → text',
                title: 'Plain, safe content',
                body: 'Release text is flattened to escaped plain text, so nothing in a release can run in an inbox.',
              },
            ]}
          />
        </div>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Is this a newsletter tool?',
            a: 'No. It emails release news to people who opted in. Drip campaigns and newsletters are out of scope.',
          },
          {
            q: 'Can I import my subscriber list?',
            a: 'Yes, with our help during early access. Addresses are normalized on import, and re-importing never brings back someone who unsubscribed.',
          },
          {
            q: 'Is release email available now?',
            a: 'Sending is built and running. It is part of early access while the writing screens are finished.',
          },
        ]}
      />

      <Section>
        <SectionIntro
          label="Related"
          lead="Read how publishing works,"
          trail="how a feature launch runs, and Shots for developer tools."
        />
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
