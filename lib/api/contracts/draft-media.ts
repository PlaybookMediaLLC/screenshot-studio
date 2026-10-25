import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { memberDocs } from '@/lib/api/contracts/workspace-docs'

/** `POST /api/v1/content-drafts/link-image`: persist an explicitly selected page image. */
export const draftLinkImageContract = defineContract({
  docs: memberDocs({
    operationId: 'attachDraftLinkImage',
    description: 'Resolve a safe page image and store a validated workspace attachment.',
    tag: 'Assets',
    responses: {
      '200': 'Durable image attachment.',
      '422': 'No safe, supported image is available.',
    },
  }),
  body: z.object({ url: z.string().url().max(2_000) }),
  method: 'POST',
  name: 'content-drafts.link-image',
  output: z.object({
    assetId: z.string(),
    sourceUrl: z.string(),
    width: z.number(),
    height: z.number(),
  }),
  path: '/api/v1/content-drafts/link-image',
  summary: 'Attach a validated page image to the workspace',
})

/** Authorized GIPHY search, disabled until provider approval is configured. */
export const draftGiphySearchContract = defineContract({
  docs: memberDocs({
    operationId: 'searchDraftGiphy',
    description:
      'Search GIFs only with operator-confirmed provider approval for server search and storage.',
    tag: 'Assets',
    responses: {
      '200': 'Approved GIF search results.',
      '503': 'Approval is not configured or GIPHY is unavailable.',
    },
  }),
  method: 'GET',
  name: 'content-drafts.giphy-search',
  path: '/api/v1/content-drafts/giphy',
  query: z.object({ q: z.string().trim().min(1).max(100) }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        previewUrl: z.string().url(),
        sourceUrl: z.string().url(),
      })
    ),
  }),
  summary: 'Search the approved GIPHY integration',
})

/** Attach a selected GIF after provider revalidation and tenant asset verification. */
export const draftGiphyAttachContract = defineContract({
  docs: memberDocs({
    operationId: 'attachDraftGiphy',
    description: 'Revalidate a selected GIF and persist it through the workspace upload pipeline.',
    tag: 'Assets',
    responses: {
      '200': 'Durable GIF attachment.',
      '422': 'The selected GIF is unavailable or invalid.',
      '503': 'Approval is not configured or GIPHY is unavailable.',
    },
  }),
  method: 'POST',
  name: 'content-drafts.giphy-attach',
  path: '/api/v1/content-drafts/giphy',
  body: z.object({ id: z.string().regex(/^[A-Za-z0-9]{1,80}$/) }),
  output: z.object({ assetId: z.string(), sourceUrl: z.string() }),
  summary: 'Attach a GIF through an approved durable-storage integration',
})
