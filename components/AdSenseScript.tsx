"use client";

import { useEffect, useState } from "react";
import { ADSENSE_CLIENT } from "@/lib/adsense";
import { adsAllowed, CONSENT_CHANGE_EVENT, readConsent } from "@/lib/consent";

/**
 * AdSense loader for content pages only; editor workspaces and error pages never render it.
 * It loads only after the visitor accepts advertising cookies, and never with GPC on.
 */
export function AdSenseScript() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const update = () => setAllowed(adsAllowed(readConsent()));
    update();
    window.addEventListener(CONSENT_CHANGE_EVENT, update);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, update);
  }, []);
  if (!allowed) return null;
  return (
    <script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      crossOrigin="anonymous"
    />
  );
}
