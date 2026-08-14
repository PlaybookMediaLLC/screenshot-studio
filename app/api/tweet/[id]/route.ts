import { NextRequest, NextResponse } from 'next/server'
import { getTweet } from 'react-tweet/api'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const tweet = await getTweet(id)
    if (!tweet) {
      return NextResponse.json({ data: null, error: 'Tweet not found' }, { status: 404 })
    }
    return NextResponse.json({ data: tweet })
  } catch {
    return NextResponse.json({ data: null, error: 'Failed to fetch tweet' }, { status: 500 })
  }
}
