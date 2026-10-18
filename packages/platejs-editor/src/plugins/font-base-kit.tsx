import {
  BaseFontBackgroundColorPlugin,
  BaseFontColorPlugin,
  BaseFontFamilyPlugin,
  BaseFontSizePlugin,
  BaseFontWeightPlugin,
} from "@platejs/basic-styles";
import type { SlatePluginConfig } from "platejs";
import { KEYS } from "platejs";

const options = {
  inject: {
    targetPlugins: [
      ...KEYS.heading,
      KEYS.p,
      KEYS.blockquote,
      KEYS.callout,
      KEYS.toggle,
    ],
  },
} satisfies SlatePluginConfig;

export const BaseFontKit = [
  BaseFontColorPlugin.configure(options),
  BaseFontBackgroundColorPlugin.configure(options),
  BaseFontSizePlugin.configure(options),
  BaseFontFamilyPlugin.configure(options),
  BaseFontWeightPlugin.configure(options),
];
