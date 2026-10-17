import assert from 'node:assert/strict'
import test from 'node:test'
import { openRouterSettings } from '@/lib/ai/models/provider'

test('every OpenRouter model skips endpoints that may store or train on prompts', () => {
  for (const model of [
    'anthropic/claude-sonnet-5.5',
    'openai/gpt-5',
    'google/gemini-2.5-flash-image',
  ]) {
    assert.equal(openRouterSettings(model).provider?.data_collection, 'deny')
  }
})
