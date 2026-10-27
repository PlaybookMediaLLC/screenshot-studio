import { client } from '../lib/runtime'
/** Plan a time only. This tool cannot approve, schedule a delivery, or publish. */
export default async function planDraft(input: {id:string;plannedFor:string;timeZone:string}) {const api=client();const draft=await api.plan(input.id,input.plannedFor,input.timeZone);return {...draft,reviewUrl:api.draftURL(draft.id),publishing:'Not scheduled. A human must confirm in Shots.'}}
