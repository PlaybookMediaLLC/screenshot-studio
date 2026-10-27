import { aiValue } from "./ai-value";
import { basicElementsValue } from "./basic-elements-value";
import { basicMarksValue } from "./basic-marks-value";
import { basicNodesValue } from "./basic-nodes-value";
import { blockMenuValue } from "./block-menu-value";
import { calloutValue } from "./callout-value";
import { columnValue } from "./column-value";
import { copilotValue } from "./copilot-value";
import { dateValue } from "./date-value";
import { discussionValue } from "./discussion-value";
import { dndValue } from "./dnd-value";
import { emojiValue } from "./emoji-value";
import { equationValue } from "./equation-value";
import { floatingToolbarValue } from "./floating-toolbar-value";
import { horizontalRuleValue } from "./horizontal-rule-value";
import { linkValue } from "./link-value";
import { mediaToolbarValue } from "./media-toolbar-value";
import { mediaValue } from "./media-value";
import { mentionValue } from "./mention-value";
import { selectionValue } from "./selection-value";
import { slashMenuValue } from "./slash-menu-value";
import { tableValue } from "./table-value";
import { uploadValue } from "./upload-value";

const values = {
  "ai-demo": aiValue,
  "basic-elements-demo": basicElementsValue,
  "basic-marks-demo": basicMarksValue,
  "basic-nodes-demo": basicNodesValue,
  "block-menu-demo": blockMenuValue,
  "block-selection-demo": selectionValue,
  "callout-demo": calloutValue,
  "column-demo": columnValue,
  "copilot-demo": copilotValue,
  "date-demo": dateValue,
  "discussion-demo": discussionValue,
  "dnd-demo": dndValue,
  "emoji-demo": emojiValue,
  "equation-demo": equationValue,
  "floating-toolbar-demo": floatingToolbarValue,
  // 'font-demo': fontValue,
  "horizontal-rule-demo": horizontalRuleValue,
  "link-demo": linkValue,
  // 'list-demo': listValue,
  "media-demo": mediaValue,
  "media-toolbar-demo": mediaToolbarValue,
  "mention-demo": mentionValue,
  "slash-menu-demo": slashMenuValue,
  "table-demo": tableValue,
  "upload-demo": uploadValue,
};

export const DEMO_VALUES = Object.entries(values).reduce(
  (acc, [key, value]) => {
    const demoKey = key.replace("Value", "-demo");
    acc[demoKey] = value;

    return acc;
  },
  {} as Record<string, unknown>
);
