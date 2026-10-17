# AI Use Policy — DRAFT

> **DRAFT — requires counsel review.** Not legal advice. Not published.

## Summary

- Shots uses third-party AI models to draft copy, generate images, write captions and review
  designs.
- The content a request needs goes to those models. It is not used to train them.
- AI output can be wrong. A person on your team reviews and approves every post before it is
  published.
- You are responsible for what you publish, including any AI disclosure a law or platform
  requires.

**Effective:** [[EFFECTIVE DATE]]

## What the AI does

| Feature | What it sends to the model |
| --- | --- |
| Launch drafting (spec, plan, copy, visuals) | Your brief, release notes, PR titles, text from your product website and source links, brand voice and brand kit |
| Captions and alt text | An image of your design, its text, your brand voice |
| Design critique and variants | Your design, and optionally an image of it |
| Campaign chat | Your messages and your workspace's product and brand details |
| AI backgrounds | Your prompt and colour palette |
| App Store copy and translation | The product facts and copy you enter |
| Editor copilot | Your chat messages, the selected elements and the design's state |
| Link-preview copy suggestions | The page fetched from the URL you check |
| Onboarding | Your website's homepage and up to four pages, plus your one-line description |

**Models.** As of [[EFFECTIVE DATE]] we use these, through OpenRouter:

- Anthropic Claude Opus, Sonnet and Haiku (text and vision);
- Google Gemini (images).

See the [subprocessor list](/subprocessors).

## Your data

- We do not train models on your content, and we tell our providers not to retain it or train
  on it. [[PRODUCT: OpenRouter `data_collection: deny` / ZDR]] [[COUNSEL: confirm provider
  terms]]
- Prompts and outputs are kept with your workspace (drafts, chat history) until the workspace is
  deleted. [[PRODUCT: let members delete chat history and drafts]]
- Untrusted web content is marked as untrusted in prompts and checked for injection attempts.
- Workspace owners and admins can turn AI features off. [[PRODUCT: cover all AI endpoints]]

## Human review

- AI tools can create drafts and submit them for review. They cannot approve, schedule or
  publish.
- A member with approval rights approves each post, and a member with publishing rights
  schedules it.
- Shots does not offer autonomous publishing. [[OWNER: revisit if RFC 031 autonomy modes ship]]
  [[PRODUCT: close the legacy social backend's public API and MCP routes, which bypass approval]]
- During onboarding, the first AI product brief and plan are accepted for you so you can start
  quickly. Posts still need your approval. [[PRODUCT/OWNER: consider showing the brief before
  accepting it]]

## Labelling

- AI-written launch specs are marked "AI draft" in the app. [[PRODUCT: mark AI-drafted posts
  too]]
- Where a platform offers an AI-content flag, such as X "made with AI", Shots sets it on
  AI-drafted posts. [[PRODUCT: set the flags]]
- You are responsible for any further disclosure a law or platform requires. This includes the
  EU AI Act's transparency rules and FTC endorsement guidance, which counsel should confirm for
  your markets.

## Rules

Follow the [Acceptable Use Policy](/acceptable-use). In particular:

- Don't generate deceptive content or fake testimonials.
- Don't make realistic images of real people without their consent.
- Don't use another party's trademarks in a misleading way.

## Output

- As between you and us, you own the output generated for you.
- Output may not be protectable by copyright, and may resemble output made for others.
- Check facts, claims, prices and legal statements before you publish.
