/** Up to two initials for a workspace badge: "Acme Launch Team" → "AL". */
export function workspaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (
    words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0]?.slice(0, 2) ?? '')
  ).toUpperCase()
}
