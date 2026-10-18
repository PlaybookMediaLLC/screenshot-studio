"use client";

import {
  FontBackgroundColorPlugin,
  FontColorPlugin,
  FontFamilyPlugin,
  FontSizePlugin,
  FontWeightPlugin,
} from "@platejs/basic-styles/react";
import { KEYS } from "platejs";
import type { PlatePluginConfig } from "platejs/react";

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
} satisfies PlatePluginConfig;

export const FontKit = [
  FontColorPlugin.configure({
    inject: {
      ...options.inject,
      nodeProps: {
        defaultNodeValue: "black",
      },
    },
  }),
  FontBackgroundColorPlugin.configure(options),
  FontSizePlugin.configure(options),
  FontFamilyPlugin.configure(options),
  FontWeightPlugin.configure(options),
];
