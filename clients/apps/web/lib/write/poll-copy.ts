import type { PostPoll } from './document'

/** An existing poll the composer can reuse without replacing a platform's post. */
export type PollSource = { key: string; label: string; poll: PostPoll }

/** Copy choices verbatim; the destination keeps its question, duration and voting mode.
 * Incompatible choices remain visible to the normal platform validation, never truncated.
 */
export function copyPollOptions(source: PostPoll, destination: PostPoll): PostPoll {
  return { ...destination, options: [...source.options] }
}
