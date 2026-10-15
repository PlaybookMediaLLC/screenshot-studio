import { z } from 'zod'
import { agentMarkdownResponse } from '@/lib/agents/markdown-response'

/** The catch-all path segments; `__root__` stands for `/`. */
const markdownParamsSchema = z.object({ path: z.array(z.string()) })

/** The Markdown rendering of a site page, for agents that send `Accept: text/markdown`. */
export async function GET(
  _: Request,
  context: { params: Promise<z.input<typeof markdownParamsSchema>> }
) {
  const { path } = markdownParamsSchema.parse(await context.params)
  const pathname = path.length === 1 && path[0] === '__root__' ? '/' : `/${path.join('/')}`
  return agentMarkdownResponse(pathname)
}
