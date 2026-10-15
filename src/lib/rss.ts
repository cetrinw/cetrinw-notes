import { changed, command, get, learningCommand, list, save } from "./db";
import type { Entry } from "../types";
import directory from "./feed-directory.json";

export const feedDirectory = directory as {
  title: string;
  category: string;
  url: string;
  description: string;
}[];
const inflight = new Map<string, Promise<number>>();
/** Reading mode backfill: summary-only articles get their full text fetched
 * from the original page, politely and with a per-refresh cap. Returns how
 * many articles were upgraded. Failures keep the summary untouched. */
export async function fetchFullTexts(articles: any[], limit = 5) {
  const candidates = (articles || [])
    .filter((a) => a?.data?.contentType === "summary" && a?.data?.sourceUrl)
    .slice(0, limit);
  let updated = 0;
  for (const article of candidates) {
    try {
      const extracted = await learningCommand({
        op: "article_extract",
        url: article.data.sourceUrl,
      });
      const latest = await get(article.id);
      if (latest && !latest.deleted && latest.data.contentType === "summary") {
        await save({
          ...latest,
          data: {
            ...latest.data,
            text: extracted.text,
            contentType: "extracted",
            extractedAt: new Date().toISOString(),
          },
        });
        updated++;
      }
    } catch {
      /* Keep the summary; the manual button stays available. */
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return updated;
}
export function refreshFeed(feed: Entry): Promise<number> {
  if (inflight.has(feed.id)) return inflight.get(feed.id)!;
  const promise = (async () => {
    try {
      const result = await learningCommand({
        op: "rss_fetch",
        url: feed.data.url,
        id: feed.id,
      });
      await command({ op: "news_import", articles: result.articles });
      if (feed.data.autoFullText !== false) {
        await fetchFullTexts(result.articles, 5);
      }
      changed("article");
      const latest = await get(feed.id);
      if (latest && !latest.deleted)
        await save({
          ...latest,
          data: {
            ...latest.data,
            lastSuccess: new Date().toISOString(),
            lastAttempt: new Date().toISOString(),
            status: "success",
            error: null,
            count: result.articles.length,
          },
        });
      return result.articles.length;
    } catch (error) {
      const latest = await get(feed.id);
      if (latest && !latest.deleted)
        await save({
          ...latest,
          data: {
            ...latest.data,
            lastAttempt: new Date().toISOString(),
            status: "failed",
            error: String(error),
          },
        });
      throw error;
    }
  })().finally(() => inflight.delete(feed.id));
  inflight.set(feed.id, promise);
  return promise;
}
export function startFeedScheduler() {
  let stopped = false,
    running = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      for (const feed of await list("feed", "", 200)) {
        if (stopped) break;
        const interval =
          Math.max(15, Number(feed.data.intervalMinutes) || 60) * 60000;
        if (
          feed.data.enabled !== false &&
          (!feed.data.lastAttempt ||
            Date.now() - new Date(feed.data.lastAttempt).getTime() >= interval)
        ) {
          try {
            await refreshFeed(feed);
          } catch {
            /* Failure is persisted on the subscription. */
          }
        }
      }
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(() => void tick(), 3000),
    timer = setInterval(() => void tick(), 60000);
  return () => {
    stopped = true;
    clearTimeout(initial);
    clearInterval(timer);
  };
}
