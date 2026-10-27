import { Action, ActionPanel, List, showToast, Toast } from '@raycast/api'
import { useEffect, useState } from 'react'
import { client } from './lib/runtime'

export default function Queue() {
  const [items,setItems]=useState<Awaited<ReturnType<ReturnType<typeof client>['queue']>>>([])
  const [loading,setLoading]=useState(true)
  useEffect(()=>{void client().queue().then(setItems).catch((error:Error)=>showToast({style:Toast.Style.Failure,title:'Cannot load queue',message:error.message})).finally(()=>setLoading(false))},[])
  return <List isLoading={loading} searchBarPlaceholder="Search recent and upcoming deliveries">
    {items.map((item)=><List.Item key={item.id} title={item.draftTitle || item.caption} subtitle={`${item.platform} · ${new Date(item.scheduledFor).toLocaleString()}`} accessories={[{text:item.status}]} actions={<ActionPanel><Action.OpenInBrowser title="Review Delivery in Shots" url={client().draftURL(item.draftId)}/></ActionPanel>}/>)}
  </List>
}
