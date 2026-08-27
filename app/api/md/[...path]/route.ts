import { agentMarkdownResponse } from '@/lib/agents/markdown-response'

type MarkdownRouteContext = {
  params: Promise<{ path: string[] }>
}

export async function GET(_: Request, context: MarkdownRouteContext) {
  const { path } = await context.params
  const pathname = path.length === 1 && path[0] === '__root__' ? '/' : `/${path.join('/')}`
  return agentMarkdownResponse(pathname)
}
