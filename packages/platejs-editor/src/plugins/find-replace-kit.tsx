"use client";

import { FindReplacePlugin } from "@platejs/find-replace";

import { SearchHighlightLeaf } from "../ui/search-highlight-node";

export const findReplacePlugin = FindReplacePlugin.configure({
  render: { node: SearchHighlightLeaf },
});

export const FindReplaceKit = [findReplacePlugin];
