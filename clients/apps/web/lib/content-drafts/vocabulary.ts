/**
 * The @handles and #hashtags a workspace already writes, most used first:
 * the composer offers them back in the @ picker and as hashtag chips. Pulled
 * from the workspace's own drafts, so nothing leaves the workspace.
 *
 * ponytail: handles are not tied to a platform (a LinkedIn and an X handle
 * look alike); keep the channel with each use if writers mix them up.
 */

const HANDLE = /(?:^|[^\w@])@([A-Za-z0-9_]{2,30})\b/g
const HASHTAG = /(?:^|[^\p{L}\p{N}_#&])#([\p{L}\p{N}_]{2,40})/gu

function ranked(matches: string[], limit: number): string[] {
  const counts = new Map<string, { count: number; first: number; word: string }>()
  matches.forEach((word, index) => {
    const key = word.toLowerCase()
    const known = counts.get(key)
    if (known) known.count += 1
    else counts.set(key, { count: 1, first: index, word })
  })
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, limit)
    .map(({ word }) => word)
}

/** The handles and hashtags in `texts`, by how often they appear. */
export function draftVocabulary(texts: string[]): { handles: string[]; hashtags: string[] } {
  const handles: string[] = []
  const hashtags: string[] = []
  for (const text of texts) {
    for (const match of text.matchAll(HANDLE)) handles.push(match[1])
    for (const match of text.matchAll(HASHTAG)) {
      // A hashtag of digits alone ("#1") is a number, not a tag.
      if (!/^\d+$/.test(match[1])) hashtags.push(match[1])
    }
  }
  return { handles: ranked(handles, 30), hashtags: ranked(hashtags, 12) }
}
