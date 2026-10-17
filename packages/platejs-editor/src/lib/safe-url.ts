const SAFE_PROTOCOLS = new Set(["blob:", "http:", "https:"]);

export const isSafeUrl = (input: string): boolean => {
  const url = input.trim();

  if (!url) return false;

  // Allow site-relative URLs but block protocol-relative URLs ("//evil.com").
  if (url.startsWith("/")) {
    return !url.startsWith("//");
  }

  try {
    const parsed = new URL(url);

    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
};

export const openSafeUrl = (
  input: string,
  target: "_self" | "_blank" = "_blank"
): Window | null => {
  if (typeof window === "undefined") return null;

  const url = input.trim();

  if (!isSafeUrl(url)) return null;

  const features = target === "_blank" ? "noopener,noreferrer" : undefined;
  const opened = window.open(url, target, features);

  if (target === "_blank" && opened) {
    try {
      opened.opener = null;
    } catch {
      // ignore
    }
  }

  return opened;
};
