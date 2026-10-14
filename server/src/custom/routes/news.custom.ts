import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { safeFetch } from '../../lib/safeFetch';
import { NewsItem, parseNewsFeed, rankNewsItems } from '../lib/news.custom';
import logger from '../../lib/logger';

// =============================================================================
// GET /api/news — the board's Belgian news tile.
//
// One public Atom feed (VRT NWS headlines), read-only, no database. The
// family is one household with one wall display, so the parsed list is cached
// in-process for 30 minutes, unkeyed; a cache stampede is fine at the board's
// polling cadence and the feed is public.
// =============================================================================

const FEED_URL = 'https://www.vrt.be/vrtnws/nl.rss.headlines.xml';
const CACHE_TTL_MS = 30 * 60_000;

const router = Router();
router.use(authMiddleware);

let cache: { at: number; items: NewsItem[] } | null = null;

const fetchNews = async (): Promise<NewsItem[]> => {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;
    const res = await safeFetch(FEED_URL, { timeoutMs: 10_000 });
    if (!res.ok) throw new Error(`news upstream HTTP ${res.status}`);
    const items = parseNewsFeed(await res.text());
    cache = { at: Date.now(), items };
    return items;
};

router.get('/', async (_req: AuthRequest, res) => {
    try {
        res.json({ success: true, data: { items: rankNewsItems(await fetchNews()), city: 'Belgique' } });
    } catch (error) {
        logger.error('news.fetch_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ success: false, error: 'news.unreachable' });
    }
});

export default router;
