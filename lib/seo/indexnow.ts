import sitemap from "@/app/sitemap";
import { SITE_URL } from "@/lib/seo/metadata";

export const INDEXNOW_KEY = process.env.INDEXNOW_KEY ?? "";

export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Submits every sitemap URL to the IndexNow network in one batch. */
export async function submitSitemapToIndexNow(): Promise<{
  ok: boolean;
  status: number;
  urls: number;
}> {
  const urlList = sitemap().map((entry) => entry.url);

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(SITE_URL).host,
      key: INDEXNOW_KEY,
      keyLocation: `${SITE_URL}${INDEXNOW_KEY_PATH}`,
      urlList,
    }),
  });

  return { ok: response.ok, status: response.status, urls: urlList.length };
}
