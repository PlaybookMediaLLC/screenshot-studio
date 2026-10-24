import data from "@emoji-mart/data";

/** The same emoji vocabulary used by Plate's :alias completion. */
export type SearchEmoji = { id: string; name: string; native: string };

const vocabulary = data as unknown as {
  emojis: Record<
    string,
    { name: string; skins: { native: string }[]; keywords: string[] }
  >;
};
const entries = Object.entries(vocabulary.emojis).map(([id, emoji]) => ({
  id,
  name: emoji.name,
  native: emoji.skins[0].native,
  keywords: `${id} ${emoji.name} ${emoji.keywords.join(" ")}`.toLowerCase(),
}));

/** Search names, aliases and keywords without changing the editor selection. */
export function searchEmoji(query: string): SearchEmoji[] {
  const normalized = query.toLowerCase().replace(/:/g, "").trim();
  const terms = normalized.split(/\s+/);
  return entries
    .filter((emoji) => terms.every((term) => emoji.keywords.includes(term)))
    .sort(
      (left, right) =>
        Number(right.id === normalized) - Number(left.id === normalized)
    )
    .slice(0, 80);
}
