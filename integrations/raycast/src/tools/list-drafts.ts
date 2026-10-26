import { client } from '../lib/runtime'
/** Lists visible sets when socialSetId is omitted, along with matching draft results. */
export default async function listDrafts(input: {search?:string;socialSetId?:string;view?:'drafts'|'scheduled'|'posted'|'archived'}) { const api=client();return {sets: input.socialSetId ? undefined : await api.sets(), drafts:await api.list(input)} }
