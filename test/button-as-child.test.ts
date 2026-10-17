import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '@/components/ui/button'

test('an asChild button styles its child element', () => {
  const html = renderToStaticMarkup(
    createElement(
      Button,
      { asChild: true, variant: 'outline' },
      createElement('a', { href: '/s/token' }, 'Open')
    )
  )
  assert.match(html, /^<a [^>]*data-slot="button"/)
  assert.match(html, /class="[^"]*border/)
})
