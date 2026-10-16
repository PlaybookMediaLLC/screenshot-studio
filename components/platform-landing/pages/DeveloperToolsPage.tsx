import { PRODUCT_FACTS } from '@/lib/seo/product-facts'
import { cn } from '@/lib/utils'
import { CodeTabs } from '../CodeTabs'
import { FaqBlock, LinkCards, MarketingShell, PageHero, SplitFeature, TileGrid } from '../blocks'
import { ChangelogMock } from '../mocks'
import { MONO, MUTED, Section, SectionIntro, Stage, Window } from '../primitives'
import { SpecMock } from '../WorkflowSection'

function CodeImageMock() {
  return (
    <Window meta="/code" title="Code image">
      <div
        className="rounded-lg p-6"
        style={{ background: 'linear-gradient(135deg, #2b2b2b, #8c8c8c)' }}
      >
        <div className="rounded-lg bg-[#0d0d0d] p-4 shadow-2xl">
          <div className="mb-3 flex gap-1.5">
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
          </div>
          <pre className={cn(MONO, 'text-[12px] leading-[1.7]')}>
            <span className="text-white/45">{'// set it once'}</span>
            {'\n'}
            <span className="text-white">invoice</span>
            <span className="text-white/60">.schedule(</span>
            <span className="text-emerald-300">{"'monthly'"}</span>
            <span className="text-white/60">)</span>
          </pre>
        </div>
      </div>
    </Window>
  )
}

/** /solutions/developer-tools: launches for products whose users read code. */
export function DeveloperToolsPage() {
  return (
    <MarketingShell finale={{ lead: 'Launches your users', trail: 'can check.' }}>
      <PageHero
        body="Developers read the pull request before they believe the tweet. Screenshot Studio starts from the pull request too: releases arrive from CI or a webhook, every claim cites its source, and the changelog says what the release does not do."
        eyebrow={{ href: '/use-cases', label: 'Developer tools', parent: 'Solutions' }}
        lead="For products"
        location="developer_tools_hero"
        primary={{ href: '/product/release-intake', label: 'Explore the API' }}
        secondary={{ href: '/sign-up', label: 'Get started' }}
        trail="developers use."
      >
        <Stage className="px-4 py-12 sm:px-12 sm:py-20" variant={3}>
          <div className="w-full min-w-0 max-w-[760px]">
            <CodeTabs />
          </div>
        </Stage>
      </PageHero>

      <Section>
        <SectionIntro
          body="Your audience can tell marketing from engineering. Keep the launch close to the engineering."
          label="Credibility"
          lead="Claims that cite"
          trail="the pull request."
        />
        <div className="mt-24 space-y-24">
          <SplitFeature
            body="Pull requests and GitHub releases are read through the GitHub API and numbered as sources. Every claim in the spec points at one, and posts may only cite claims the spec contains."
            bullets={[
              'No benchmark the sources do not state',
              'Limitations are part of the spec',
              'Hype words are rejected outright',
            ]}
            index={0}
            link={{ href: '/product/guardrails', label: 'Read about the guardrails' }}
            title="Sourced, not spun"
          >
            <SpecMock />
          </SplitFeature>
          <SplitFeature
            body="The changelog entry comes from the same spec as the posts, so release notes and announcements never disagree."
            index={1}
            link={{ href: '/use-cases/changelog-and-email', label: 'Changelog and email' }}
            title="A changelog that matches"
          >
            <ChangelogMock />
          </SplitFeature>
          <SplitFeature
            body={`Some launches are best shown as code. The code image editor ships ${PRODUCT_FACTS.codeThemes} syntax themes, ${PRODUCT_FACTS.codeLanguages} languages, and shareable links, free in your browser.`}
            index={2}
            link={{ href: '/code', label: 'Open code to image' }}
            title="Show the code"
          >
            <CodeImageMock />
          </SplitFeature>
        </div>
      </Section>

      <Section>
        <SectionIntro
          body="Your docs are read by agents now. So are ours."
          label="Machine-readable"
          lead="Built for the tools"
          trail="your users use."
        />
        <div className="mt-24">
          <TileGrid
            items={[
              {
                snippet: '/openapi.json',
                title: 'OpenAPI 3.1',
                body: 'Generated from the Zod contracts the routes validate with, with a live Scalar reference.',
              },
              {
                snippet: '/llms.txt',
                title: 'llms.txt',
                body: 'A Markdown overview and a long-form reference for agents and LLM crawlers.',
              },
              {
                snippet: 'Accept: text/markdown',
                title: 'Markdown pages',
                body: 'Supported pages return Markdown when an agent asks for it.',
              },
            ]}
          />
        </div>
        <p className={cn('mt-8 max-w-[760px] text-[15px] leading-[1.6]', MUTED)}>
          The platform is open source. Read the code, file an issue, or run it yourself.
        </p>
      </Section>

      <FaqBlock
        items={[
          {
            q: 'Can it read private repositories?',
            a: 'Release webhooks from private repositories work. Pull request links are read through the public GitHub API, so for a private repository put the key details in the brief, where they count as trusted.',
          },
          {
            q: 'Does it read our source code?',
            a: 'No. It reads the title and description of the pull requests and releases you link, not file contents or diffs.',
          },
          {
            q: 'Can we trigger launches from CI?',
            a: 'Yes. POST the release from your pipeline with an API key and an idempotency key, or rely on the release webhook.',
          },
        ]}
      />

      <Section>
        <SectionIntro label="Related" lead="Keep reading." trail="Every part connects." />
        <div className="mt-24">
          <LinkCards paths={['/product/release-intake', '/integrations', '/product/guardrails']} />
        </div>
      </Section>
    </MarketingShell>
  )
}
