import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, buttonVariants } from '@/components/ui/button'

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

test('custom canvas buttons preserve geometry, form attributes, and keyboard focus styles', () => {
  const html = renderToStaticMarkup(
    createElement(Button, {
      variant: 'custom',
      size: null,
      type: 'submit',
      name: 'decision',
      value: 'approve',
      disabled: true,
      className: 'absolute size-3 rounded-full',
      'aria-label': 'Approve',
    })
  )
  assert.match(html, /name="decision"/)
  assert.match(html, /value="approve"/)
  assert.match(html, /disabled=""/)
  assert.match(html, /focus-visible:ring-/)
  assert.doesNotMatch(html, /inline-flex|h-9|px-4/)
  assert.match(buttonVariants(), /inline-flex/)
  assert.match(buttonVariants(), /h-9/)
})
