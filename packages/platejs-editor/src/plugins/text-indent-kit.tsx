"use client";

import { TextIndentPlugin } from "@platejs/basic-styles/react";
import { KEYS } from "platejs";

export const TextIndentKit = [
  TextIndentPlugin.configure({
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
