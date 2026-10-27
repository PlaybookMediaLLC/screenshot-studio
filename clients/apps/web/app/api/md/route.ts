import { NextRequest } from 'next/server'
import { agentMarkdownResponse } from '@/lib/agents/markdown-response'

export async function GET(request: NextRequest) {
  return agentMarkdownResponse(request.nextUrl.searchParams.get('path') || '/')
}
