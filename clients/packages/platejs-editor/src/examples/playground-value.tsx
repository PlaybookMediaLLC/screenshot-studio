import { aiValue } from "./ai-value";
import { blockMenuValue } from "./block-menu-value";
import { calloutValue } from "./callout-value";
import { copilotValue } from "./copilot-value";
import { equationValue } from "./equation-value";
import { floatingToolbarValue } from "./floating-toolbar-value";
import { mediaToolbarValue } from "./media-toolbar-value";
import { slashMenuValue } from "./slash-menu-value";
import { tocValue } from "./toc-value";
import { uploadValue } from "./upload-value";

import type { Descendant, Value } from "platejs";

const addDeterministicIds = (
  nodes: Descendant[],
  parentPath: readonly number[] = []
): Descendant[] =>
  nodes.map((node, index) => {
    if ("text" in node) {
      return node;
    }

    const path = [...parentPath, index];

    return {
      ...node,
      children: addDeterministicIds(node.children, path),
      id: `playground-${path.join("-")}`,
    };
  });

export const playgroundValue = addDeterministicIds([
  ...tocValue,
  ...aiValue,
  ...copilotValue,
  ...calloutValue,
  ...equationValue,
  ...uploadValue,
  ...slashMenuValue,
  ...blockMenuValue,
  ...floatingToolbarValue,
  ...mediaToolbarValue,
] as Value) as Value;
