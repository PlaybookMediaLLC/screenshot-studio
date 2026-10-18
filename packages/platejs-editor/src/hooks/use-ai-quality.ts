"use client";

import { useEffect, useRef } from "react";
import {
  dispatchEditorAIQuality,
  editorActionForTool,
  type EditorToolName,
} from "../lib/ai-editor";

type AIRequestStatus = "error" | "ready" | "submitted" | "streaming";

const isLoading = (status: AIRequestStatus): boolean =>
  status === "submitted" || status === "streaming";

export const useAIQuality = ({
  mode,
  status,
  toolName,
}: {
  mode: "chat" | "insert";
  status: AIRequestStatus;
  toolName: EditorToolName | null;
}): void => {
  const startedAtRef = useRef<number | null>(null);
  const previousStatusRef = useRef<AIRequestStatus>("ready");

  useEffect(() => {
    const previous = previousStatusRef.current;
    const action = editorActionForTool(toolName);
    if (!isLoading(previous) && isLoading(status)) {
      startedAtRef.current = performance.now();
      dispatchEditorAIQuality({ action, event: "started", mode });
    }
    if (isLoading(previous) && !isLoading(status)) {
      const durationMs = Math.round(performance.now() - (startedAtRef.current ?? 0));
      dispatchEditorAIQuality({
        action,
        durationMs,
        event: status === "error" ? "failed" : "finished",
        mode,
      });
      startedAtRef.current = null;
    }
    previousStatusRef.current = status;
  }, [mode, status, toolName]);
};
