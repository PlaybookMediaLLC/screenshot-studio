# AI Use Policy (draft)

> **DRAFT — requires counsel review.** Not legal advice. Do not publish. Shots has no AI policy
> today. Code baseline: commit `bad06b3e`.

## Summary

- Shots uses AI to read releases and websites, draft posts, make visuals, edit designs, and write
  captions.
- AI requests go to model providers through OpenRouter.
- AI never approves or publishes a post. A teammate approves each post.
- You review AI output before you publish it, and you label it where a law or a platform requires.
- A workspace owner or admin can turn off AI features.

## What the code does today

| Topic                 | Behavior in code                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Providers             | OpenRouter. Default text models from Anthropic. Default image model from Google.                   |
| Inputs                | Prompts, workspace context, release sources, website text, and canvas or draft images.             |
| Storage               | AI conversations and step summaries stay in the workspace.                                         |
| Approval              | Publishing requires an approved variant. AI tools can submit drafts for review but cannot approve. |
| Off switch            | A workspace setting turns AI features off.                                                         |
| Untrusted sources     | Release and website text is fenced as untrusted data in prompts.                                   |
| Autonomous publishing | Not built (RFC 044 is not started).                                                                |
| Output labels         | None in the product yet (P13).                                                                     |
| Provider training     | No code-level setting yet (P11).                                                                   |

---

## Proposed text

**AI Use Policy**

Version `[[VERSION]]`. Effective `[[EFFECTIVE DATE]]`.

This policy is part of the [Terms of Service](terms-of-service.md).

### 1. What AI does in Shots

AI features can:

- turn a release, a changelog, or your website into a product profile and a launch brief;
- propose a campaign plan and draft posts for each channel;
- create and critique visuals and backgrounds;
- edit a design in the editor when you ask;
- write captions and alt text.

### 2. Where your data goes

1. AI features send your prompt and the context that the feature needs to OpenRouter. OpenRouter
   sends the request to a model provider. See the [subprocessor list](subprocessors.md).
2. The context can include brand data, release notes, text from websites that you ask us to read,
   and images of your canvas or drafts.
3. We do not use your content to train AI models. `[[COUNSEL: confirm the OpenRouter, Anthropic, and Google terms on training and retention, and state them here.]]` ⚑ Requires product change P11.

### 3. Human control

1. AI does not approve, schedule, or publish a post on its own. A teammate with the approve
   permission approves each post.
2. A workspace owner or admin can turn off AI features in the workspace settings.
3. If we add features that act with less human review, we will update this policy and the Terms
   first, and we will make those features opt-in.

### 4. Your responsibilities

1. Check AI output for accuracy before you use it. AI can state wrong facts, misquote sources, or
   show a product feature that does not exist.
2. Make sure that AI output does not infringe the rights of others.
3. Label AI-generated or AI-altered content where a law or a platform requires it. ⚑ Product change
   P13 adds labels in the product.
4. Do not use AI features to create content that the [Acceptable Use Policy](acceptable-use-policy.md)
   prohibits.
5. Do not try to make the AI ignore its instructions or reveal other workspaces' data.

### 5. Ownership

As between you and us, you own the AI output that you create in Shots, to the extent the law allows.
Other users can receive similar output.

### 6. Credits

AI features use AI credits from your plan. The [pricing page](https://shots.playbookmedia.io/pricing)
shows the allowances.

### 7. Report a problem

Report harmful or wrong AI output to `[[SUPPORT EMAIL]]`.
