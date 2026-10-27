import { BaseTextIndentPlugin } from "@platejs/basic-styles";
import { KEYS } from "platejs";

export const BaseTextIndentKit = [
  BaseTextIndentPlugin.configure({
    inject: {
      targetPlugins: [
        ...KEYS.heading,
        KEYS.p,
        KEYS.blockquote,
        KEYS.callout,
        KEYS.toggle,
      ],
    },
    options: {
      offset: 24,
      unit: "px",
    },
  }),
];
