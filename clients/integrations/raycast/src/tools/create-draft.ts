import { client } from '../lib/runtime'
/** Create an editable draft. Reuse requestId after an uncertain response to avoid duplicates. */
export default async function createDraft(input: {requestId:string;socialSetId:string;text:string;platforms?:string[];title?:string}) { const api=client();const draft=await api.create(input);return {...draft,reviewUrl:api.draftURL(draft.id),publishing:'Human review and scheduling required'} }
