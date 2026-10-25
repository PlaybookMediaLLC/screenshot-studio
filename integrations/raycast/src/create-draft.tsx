import { Action, ActionPanel, Form, showToast, Toast, open } from '@raycast/api'
import { useEffect, useRef, useState } from 'react'
import type { SocialSet } from './lib/client'
import { client, remember, remembered, creationRequest, confirmCreation } from './lib/runtime'

export default function CreateDraft() {
  const [sets, setSets] = useState<SocialSet[]>([])
  const [setId, setSetId] = useState('')
  const [platforms, setPlatforms] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const request = useRef<{signature:string;id:string} | null>(null)
  useEffect(() => { void Promise.all([client().sets(), remembered()]).then(([items, previous]) => {
    setSets(items)
    const set = items.find((item) => item.id === previous?.set) ?? items[0]
    if (set) { setSetId(set.id); setPlatforms(previous?.set === set.id ? previous.platforms.filter((p) => set.accounts.some((a) => a.platform === p)) : set.defaultPlatforms) }
  }).catch((error: Error) => showToast({style: Toast.Style.Failure,title:'Cannot load Shots',message:error.message})).finally(() => setLoading(false)) }, [])
  const selected = sets.find((set) => set.id === setId)
  const submit = async (values: {text:string; title:string}) => {
    if (busy) return
    setBusy(true)
    try {
      const signature = JSON.stringify({setId, platforms, ...values})
      if (request.current?.signature !== signature) request.current = {signature, id: await creationRequest(signature)}
      const api = client()
      const draft = await api.create({requestId: request.current.id, socialSetId: setId, platforms, ...values})
      await confirmCreation(signature)
      await remember(setId, platforms)
      await showToast({style:Toast.Style.Success,title:'Draft saved for review'})
      await open(api.draftURL(draft.id))
    } catch (error) { await showToast({style:Toast.Style.Failure,title:'Draft was not confirmed',message:error instanceof Error ? error.message : 'Retry using the same form.'}) }
    finally {setBusy(false)}
  }
  return <Form isLoading={loading || busy} actions={<ActionPanel><Action.SubmitForm title="Create Draft for Review" onSubmit={submit} /></ActionPanel>}>
    <Form.Dropdown id="set" title="Social Set" value={setId} onChange={(id) => {setSetId(id);setPlatforms(sets.find((set) => set.id===id)?.defaultPlatforms ?? [])}}>
      {(['PRIVATE','WORKSPACE'] as const).map((visibility) => <Form.Dropdown.Section key={visibility} title={visibility === 'PRIVATE' ? 'Personal' : 'Team'}>{sets.filter((set) => set.visibility===visibility).map((set) => <Form.Dropdown.Item key={set.id} value={set.id} title={set.name} />)}</Form.Dropdown.Section>)}
    </Form.Dropdown>
    <Form.TagPicker id="platforms" title="Platforms" value={platforms} onChange={setPlatforms}>{selected?.accounts.map((a) => <Form.TagPicker.Item key={a.id} value={a.platform} title={a.platform} />)}</Form.TagPicker>
    <Form.TextField id="title" title="Internal Title" />
    <Form.TextArea id="text" title="Draft" placeholder="Separate thread posts with a line containing ---" />
    <Form.Description text="Saved as an editable draft. Open Shots to preview, request review, and confirm publishing. Private sets unavailable to the key are never listed." />
  </Form>
}
