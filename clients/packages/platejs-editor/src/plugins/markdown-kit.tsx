import type { MdRules } from "@platejs/markdown";
import { MarkdownPlugin, remarkMdx, remarkMention } from "@platejs/markdown";
import { KEYS } from "platejs";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/**
 * Builds the markdown kit with the full canonical options, optionally adding
 * app-level serialization rules for custom nodes.
 *
 * Apps must extend through this factory rather than re-`configure()`-ing the
 * exported kit: a partial `configure({ options })` on the already-configured
 * plugin dropped `remarkPlugins`, which silently removed the GFM extension —
 * and then serializing any document containing a native table crashed with
 * "Cannot handle unknown node `table`" (serializeMd runs on every document
 * open via the AI state). The factory always carries the complete options.
 *
 * @param rules - Extra per-node-type markdown rules (e.g. a `canvas_embed`
 *   serializer). Merged over the plugin's built-ins by key.
 * @returns The markdown kit array for an editor's plugin list.
 */
export const createMarkdownKit = (rules?: MdRules) => [
  MarkdownPlugin.configure({
    options: {
      disallowedNodes: [KEYS.suggestion],
      remarkPlugins: [remarkMath, remarkGfm, remarkMdx, remarkMention],
      ...(rules ? { rules } : {}),
    },
  }),
];

export const MarkdownKit = createMarkdownKit();
