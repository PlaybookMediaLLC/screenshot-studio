import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('Shortcut source encodes explicit user input before opening the review URL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shots-shortcut-'))
  try {
    const output = join(dir, 'draft.shortcut')
    execFileSync('python3', [
      'integrations/shortcuts/build.py',
      '--origin',
      'https://shots.example',
      '--output',
      output,
    ])
    const actions = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          'import plistlib,json,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))["WFWorkflowActions"]))',
          output,
        ],
        { encoding: 'utf8' }
      )
    ) as {
      WFWorkflowActionIdentifier: string
      WFWorkflowActionParameters: Record<string, unknown>
    }[]
    assert.deepEqual(
      actions.map((action) => action.WFWorkflowActionIdentifier),
      [
        'is.workflow.actions.ask',
        'is.workflow.actions.urlencode',
        'is.workflow.actions.gettext',
        'is.workflow.actions.openurl',
      ]
    )
    const text = actions[2].WFWorkflowActionParameters.WFTextActionText as {
      Value: { string: string; attachmentsByRange: Record<string, { OutputUUID: string }> }
    }
    assert.equal(text.Value.string, 'https://shots.example/?new=\ufffc')
    assert.equal(
      Object.values(text.Value.attachmentsByRange)[0].OutputUUID,
      actions[1].WFWorkflowActionParameters.UUID
    )
    for (const origin of [
      'http://shots.example',
      'https://secret@shots.example',
      'https://shots.example/write',
      'https://shots.example?token=secret',
      'https://shots.example#private',
    ]) {
      assert.notEqual(
        spawnSync('python3', [
          'integrations/shortcuts/build.py',
          '--origin',
          origin,
          '--output',
          output,
        ]).status,
        0
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
