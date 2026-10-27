import { client } from '../lib/runtime'
/** Read one draft and its actual delivery states. */
export default async function browseDraft(input: {id:string}) {const api=client();return {draft:await api.get(input.id),deliveries:await api.posts(input.id),reviewUrl:api.draftURL(input.id)}}
