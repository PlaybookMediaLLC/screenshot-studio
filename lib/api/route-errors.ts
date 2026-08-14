import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthorizationError } from '@/lib/auth/access'

export function getRouteErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  console.error('Route request failed.', error)
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
}
