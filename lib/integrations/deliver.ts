import { z } from 'zod'
import { ProviderError } from './providers'
import { parseFigmaUrl } from './schema'

/**
 * Delivering a published design: each function calls one provider's API
 * with an access token and reports where the work landed. `fetcher` is
 * injectable so the request sequence is tested without the network.
 */

type Fetch = typeof fetch

/** The published work to deliver. */
export type Delivery = {
  altText: string | null
  bytes: Uint8Array
  fileName: string
  mediaType: string
  shareUrl: string
  title: string
}

/** Where the work landed, for the confirmation. */
export type DeliveryResult = { label: string; url: string | null }

const NOTION_VERSION = '2022-06-28'

async function notion<T extends z.ZodType>(response: Response, schema: T): Promise<z.infer<T>> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = z
      .object({ code: z.string().optional(), message: z.string().optional() })
      .safeParse(body)
    const code = message.success ? message.data.code : undefined
    const text =
      code === 'object_not_found'
        ? 'Notion cannot see that page. Share it with the integration in Notion (••• → Connections), then try again.'
        : code === 'unauthorized'
          ? 'Notion no longer accepts this connection. Connect Notion again.'
          : `Notion refused the request: ${(message.success && message.data.message) || response.status}.`
    throw new ProviderError(text, code === 'unauthorized')
  }
  return schema.parse(body)
}

const notionTitle = z
  .object({
    properties: z.record(
      z.string(),
      z.object({
        title: z.array(z.object({ plain_text: z.string() })).optional(),
        type: z.string(),
      })
    ),
  })
  .transform((page) => {
    const property = Object.values(page.properties).find((value) => value.type === 'title')
    return property?.title?.map((part) => part.plain_text).join('') || 'Untitled'
  })

/** Pages the connection can write to, matching `query`. */
export async function searchNotionPages(token: string, query: string, fetcher: Fetch = fetch) {
  const body = await notion(
    await fetcher('https://api.notion.com/v1/search', {
      body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: 20, query }),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'notion-version': NOTION_VERSION,
      },
      method: 'POST',
    }),
    z.object({
      results: z.array(
        z.object({ id: z.string(), properties: z.unknown(), url: z.string().optional() })
      ),
    })
  )
  return body.results.map((page) => {
    const title = notionTitle.safeParse(page)
    return { id: page.id, title: title.success ? title.data : 'Untitled', url: page.url ?? null }
  })
}

/** Upload the file to Notion and add it, captioned, with a bookmark to the share page, at the end of a page. */
export async function deliverToNotion(
  token: string,
  delivery: Delivery,
  target: { pageId: string },
  fetcher: Fetch = fetch
): Promise<DeliveryResult> {
  const headers = { authorization: `Bearer ${token}`, 'notion-version': NOTION_VERSION }
  const upload = await notion(
    await fetcher('https://api.notion.com/v1/file_uploads', {
      body: JSON.stringify({ content_type: delivery.mediaType, filename: delivery.fileName }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'POST',
    }),
    z.object({ id: z.string() })
  )
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(delivery.bytes)], { type: delivery.mediaType }),
    delivery.fileName
  )
  await notion(
    await fetcher(`https://api.notion.com/v1/file_uploads/${encodeURIComponent(upload.id)}/send`, {
      body: form,
      headers,
      method: 'POST',
    }),
    z.object({ status: z.string() })
  )
  const kind = delivery.mediaType.startsWith('video/') ? 'video' : 'image'
  const caption = delivery.altText ?? delivery.title
  await notion(
    await fetcher(
      `https://api.notion.com/v1/blocks/${encodeURIComponent(target.pageId)}/children`,
      {
        body: JSON.stringify({
          children: [
            {
              [kind]: {
                caption: [{ text: { content: caption.slice(0, 2000) }, type: 'text' }],
                file_upload: { id: upload.id },
                type: 'file_upload',
              },
              object: 'block',
              type: kind,
            },
            { bookmark: { url: delivery.shareUrl }, object: 'block', type: 'bookmark' },
          ],
        }),
        headers: { ...headers, 'content-type': 'application/json' },
        method: 'PATCH',
      }
    ),
    z.object({})
  )
  return { label: 'Notion', url: `https://www.notion.so/${target.pageId.replace(/-/g, '')}` }
}

/**
 * Comment on a Figma file (pinned to the frame when the link names one) with
 * the title and the share link. Figma's REST API cannot add images to a canvas.
 */
export async function deliverToFigma(
  token: string,
  delivery: Delivery,
  target: { fileUrl: string; message?: string },
  fetcher: Fetch = fetch
): Promise<DeliveryResult> {
  const file = parseFigmaUrl(target.fileUrl)
  if (!file)
    throw new ProviderError('Paste a link to a Figma file or frame (Share → Copy link in Figma).')
  const response = await fetcher(
    `https://api.figma.com/v1/files/${encodeURIComponent(file.fileKey)}/comments`,
    {
      body: JSON.stringify({
        ...(file.nodeId
          ? { client_meta: { node_id: file.nodeId, node_offset: { x: 0, y: 0 } } }
          : {}),
        message: [target.message?.trim() || delivery.title, delivery.shareUrl].join('\n'),
      }),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      method: 'POST',
    }
  )
  if (!response.ok) {
    if (response.status === 403 || response.status === 404) {
      throw new ProviderError(
        'Figma did not let this account comment on that file. Open it with the connected account, or ask for access.'
      )
    }
    throw new ProviderError(
      `Figma refused the comment (${response.status}).`,
      response.status === 401
    )
  }
  return { label: 'Figma', url: target.fileUrl }
}
