import { type ReleaseSpecContent, releaseSpecSchema } from '@/lib/launch/spec-schema'

/** A small valid spec citing brief, S1, and S2, shared by the launch tests. */
export function sampleSpec(): ReleaseSpecContent {
  return releaseSpecSchema.parse({
    audience: [
      { need: 'Bill clients without chasing payments', segment: 'Freelancers', sources: ['brief'] },
    ],
    beforeAfter: [
      { after: 'Invoices send themselves', before: 'Manual monthly invoices', sources: ['S1'] },
    ],
    capabilities: [
      { description: 'Send an invoice on a schedule', name: 'Recurring invoices', sources: ['S1'] },
      {
        description: 'Retry failed payments automatically',
        name: 'Smart retries',
        sources: ['S2'],
      },
    ],
    faqs: [
      {
        answer: 'Yes, through the existing connection.',
        question: 'Does it work with Stripe?',
        sources: ['S2'],
      },
    ],
    limitations: [{ sources: ['S1'], text: 'Only monthly and yearly schedules for now' }],
    messaging: {
      ctas: ['Set up recurring invoices'],
      pillars: [
        {
          message: 'Invoices go out on time without you',
          sources: ['brief'],
          title: 'Hands-off billing',
        },
      ],
      positioning: {
        alternatives: ['Spreadsheets'],
        sources: ['S1'],
        statement: 'Unlike spreadsheets, nothing to remember',
      },
    },
    openQuestions: [
      { question: 'Is there a usage limit?', reason: 'No source says', section: 'limitations' },
    ],
    problem: [{ sources: ['brief'], text: 'Freelancers lose time chasing invoices' }],
    proofPoints: [],
    summary: {
      sources: ['brief', 'S1'],
      text: 'Ledgerly now sends recurring invoices automatically.',
    },
    whatChanged: [{ sources: ['S1'], text: 'Invoices can repeat monthly' }],
  })
}
