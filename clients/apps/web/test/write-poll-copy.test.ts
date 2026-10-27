import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyPollOptions } from '../lib/write/poll-copy'
import { pollProblems } from '../lib/write/capabilities'

test('copying choices preserves the destination question, duration and voting mode', () => {
  const source = { options: ['Alpha', 'Beta'], question: 'Source?', durationMinutes: 1440 }
  const target = { options: ['Old', 'Choices'], question: 'Destination?', durationMinutes: 10080 }
  const copied = copyPollOptions(source, target)
  assert.deepEqual(copied, { ...target, options: ['Alpha', 'Beta'] })
  assert.deepEqual(pollProblems('linkedin', copied, 0), [])
  copied.options[0] = 'Changed'
  assert.equal(source.options[0], 'Alpha')
  assert.deepEqual(target.options, ['Old', 'Choices'])
  assert.deepEqual(
    copyPollOptions(source, { options: ['a', 'b'], durationMinutes: 45, multiple: true }),
    {
      options: ['Alpha', 'Beta'],
      durationMinutes: 45,
      multiple: true,
    }
  )
})

test('incompatible copied choices and media remain visible to publication validation', () => {
  const copied = copyPollOptions(
    { options: ['a'.repeat(31), 'b', 'c', 'd', 'e'], durationMinutes: 1440 },
    {
      options: ['Old', 'Choices'],
      question: 'Question?',
      durationMinutes: 1440,
    }
  )
  assert.equal(copied.options[0].length, 31)
  assert.equal(copied.options.length, 5)
  const problems = pollProblems('linkedin', copied, 1)
  assert.ok(problems.some((message) => message.includes('2 to 4')))
  assert.ok(problems.some((message) => message.includes('30 characters')))
  assert.ok(problems.some((message) => message.includes('media')))
})
