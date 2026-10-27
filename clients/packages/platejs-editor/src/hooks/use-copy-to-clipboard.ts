import { useState } from "react";

import { type ExternalToast, toast } from "sonner";

export const useCopyToClipboard = ({
  timeout = 2000,
}: {
  timeout?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = async (
    value: string,
    { data, tooltip }: { data?: ExternalToast; tooltip?: string } = {}
  ) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setIsCopied(true);

    setTimeout(() => {
      setIsCopied(false);
    }, timeout);

    if (tooltip) {
      toast.success(tooltip, data);
    }
  };

  return { copyToClipboard, isCopied };
};
