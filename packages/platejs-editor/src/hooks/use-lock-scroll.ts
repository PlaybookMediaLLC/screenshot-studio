import { useEffect } from "react";

export const useLockScroll = (
  lock: boolean,
  scrollContainerSelector: string
) => {
  useEffect(() => {
    if (!lock) return;
    if (typeof document === "undefined" || typeof window === "undefined")
      return;

    const scrollContainer = document.querySelector<HTMLElement>(
      scrollContainerSelector
    );

    if (!scrollContainer) return;

    const previousOverflow = scrollContainer.style.overflow;
    const previousPaddingRight = scrollContainer.style.paddingRight;

    const scrollbarWidth = Math.max(
      0,
      scrollContainer.offsetWidth - scrollContainer.clientWidth
    );
    const computedPaddingRight = Number.parseFloat(
      window.getComputedStyle(scrollContainer).paddingRight
    );
    const basePaddingRight = Number.isFinite(computedPaddingRight)
      ? computedPaddingRight
      : 0;

    scrollContainer.style.paddingRight = `${basePaddingRight + scrollbarWidth}px`;
    scrollContainer.style.overflow = "hidden";

    return () => {
      scrollContainer.style.overflow = previousOverflow;
      scrollContainer.style.paddingRight = previousPaddingRight;
    };
  }, [lock, scrollContainerSelector]);
};
