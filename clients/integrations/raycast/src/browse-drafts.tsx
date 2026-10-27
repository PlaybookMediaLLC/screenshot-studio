import { Action, ActionPanel, Alert, confirmAlert, List, showToast, Toast } from '@raycast/api'
import { useEffect, useState } from 'react'
import type { Draft } from './lib/client'
import { client } from './lib/runtime'

export default function BrowseDrafts() {
  const [search, setSearch] = useState('')
  const [view, setView] = useState('drafts')
  const [items, setItems] = useState<Draft[]>([])
  const [loading, setLoading] = useState(false)
  const [revision, refresh] = useState(0)
  useEffect(() => { let active = true; setLoading(true); void client().list({search,view}).then((rows) => {if(active)setItems(rows)}).catch((error:Error) => showToast({style:Toast.Style.Failure,title:'Cannot load drafts',message:error.message})).finally(() => {if(active)setLoading(false)}); return () => {active=false} }, [search,view,revision])
  const mutate = async (item:Draft, remove:boolean) => {
    if (remove && !await confirmAlert({title:`Delete ${item.title}?`,message:'Scheduled drafts cannot be deleted. This removes an unscheduled draft and its history.',primaryAction:{title:'Delete Draft',style:Alert.ActionStyle.Destructive}})) return
    try { if(remove)await client().delete(item.id); else await client().duplicate(item.id); refresh((v)=>v+1) }
    catch(error){await showToast({style:Toast.Style.Failure,title:'Action failed',message:error instanceof Error ? error.message : 'Try again.'})}
  }
  return <List isLoading={loading} onSearchTextChange={setSearch} throttle searchBarPlaceholder="Search draft titles and full text" searchBarAccessory={<List.Dropdown tooltip="Draft State" value={view} onChange={setView}>{['drafts','scheduled','posted','archived'].map((state)=><List.Dropdown.Item key={state} title={state} value={state}/>)}</List.Dropdown>}>
    {items.map((item)=><List.Item key={item.id} title={item.title || 'Untitled'} subtitle={item.plainText.slice(0,100)} accessories={[{text:item.status}]} actions={<ActionPanel><Action.OpenInBrowser title="Review in Shots" url={client().draftURL(item.id)}/><Action title="Duplicate Draft" onAction={()=>mutate(item,false)}/><Action title="Delete Draft" style={Action.Style.Destructive} onAction={()=>mutate(item,true)}/></ActionPanel>}/>)}
  </List>
}
