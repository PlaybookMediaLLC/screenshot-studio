import { llmsTxt } from '@/lib/agents/llms'

const UPSTREAM_REPOSITORY_URL = 'https://github.com/opennookorg/screenshot-studio'
const FORK_REPOSITORY_URL = 'https://github.com/PlaybookMediaLLC/screenshot-studio'

export async function GET() {
  const content = llmsTxt.replaceAll(UPSTREAM_REPOSITORY_URL, FORK_REPOSITORY_URL)

  return new Response(content.trim(), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Vary: 'Accept, Accept-Encoding',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}
