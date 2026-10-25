// Parsing + relevance for the board's Belgian news tile — the pure half of
// routes/news.custom.ts.
//
// The feed is VRT's own Atom (https://www.vrt.be/vrtnws/nl.rss.headlines.xml)
// and structurally stable, and xml2js cannot be imported from the server (it
// is only in node_modules via a client devDependency that the production
// image strips). So this is a boundary parser on the tags the tile needs, not
// a shortcut: <entry>, <title>, <summary>, <published>, <link href="…">
// (rel="alternate" preferred) and every <vrtns:nstag>.

export interface NewsItem {
    title: string;
    summary: string;
    published: string;
    link: string;
    tags: string[];
    /** Relevance buckets the item hit (see scoreNewsItem). */
    buckets: NewsBucket[];
}

export type NewsBucket = 'tech' | 'health' | 'family' | 'work';

const stripCdata = (value: string): string =>
    value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

const decodeEntities = (value: string): string =>
    value
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

const textField = (entry: string, tag: string): string => {
    const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return match ? decodeEntities(stripCdata(match[1])) : '';
};

/** Parse the Atom feed into boundary items; entries missing a title or a date are dropped. */
export const parseNewsFeed = (xml: string): NewsItem[] => {
    const items: NewsItem[] = [];
    for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
        const title = textField(entry, 'title');
        const published = textField(entry, 'published');
        if (!title || !published || Number.isNaN(Date.parse(published))) continue;
        // The article URL is the alternate link; the feed also carries a self
        // link and an image enclosure.
        let link = '';
        for (const tagMatch of entry.match(/<link\b[^>]*>/g) ?? []) {
            const href = tagMatch.match(/href="([^"]+)"/)?.[1] ?? '';
            if (!href) continue;
            link = href;
            if (tagMatch.includes('rel="alternate"')) break;
        }
        const tags = (entry.match(/<vrtns:nstag[^>]*>([\s\S]*?)<\/vrtns:nstag>/g) ?? [])
            .map((tag) => decodeEntities(stripCdata(tag.replace(/<\/?vrtns:nstag[^>]*>/g, ''))))
            .filter(Boolean);
        const item = { title, summary: textField(entry, 'summary'), published, link, tags, buckets: [] as NewsBucket[] };
        item.buckets = [...scoreNewsItem(item).buckets];
        items.push(item);
    }
    return items;
};

// ── Relevance ────────────────────────────────────────────────────────────────
// The family's fixed interest set: dad in software development, mum studying
// nursing, kids at school, both parents working. Sections map straight onto
// the Dutch vrtns:nstag labels; title keywords catch the stories the section
// label misses. Only the title is scanned — summaries mention children and
// care in passing far too often to be a signal (a Winnie-the-Pooh obituary
// once scored as family news).

const TAG_BUCKETS: Record<string, NewsBucket> = {
    'Technologie & Wetenschap': 'tech',
    Zorg: 'health',
    Werk: 'work',
    Economie: 'work',
    Onderwijs: 'family',
};

// National + government news is the base tier: always family-relevant.
const BASE_TIER_TAGS: Record<string, true> = { Binnenland: true, Politiek: true };

const KEYWORDS: [RegExp, NewsBucket][] = [
    [/\b(software|cyber\w*|artificiële intelligentie|\bai\b|data(?:bank|lek)?|algoritme)\b/i, 'tech'],
    [/\b(zorg|verpleeg\w*|ziekenhuis|huisarts|patiënt\w*|vaccin\w*)\b/i, 'health'],
    [/\b(peuterschool|kleuterschool|kinderopvang|kindgebeuren|ouderschapsverlof|gezinsbond|opvoeding|kinderbijslag|school\w*|onderwijs|leerkracht\w*|lerares|leerling\w*)\b/i, 'family'],
    [/\b(ontslagvergoeding|werkloosheid|verlof|pensioen|loon\w*|werknemers?|job\w*|tewerkstelling)\b/i, 'work'],
];

/** Score = number of distinct buckets hit; the matched set comes along. */
export const scoreNewsItem = (item: Pick<NewsItem, 'title' | 'tags'>): { score: number; buckets: Set<NewsBucket> } => {
    const buckets = new Set<NewsBucket>();
    for (const tag of item.tags) {
        const bucket = TAG_BUCKETS[tag];
        if (bucket) buckets.add(bucket);
    }
    for (const [pattern, bucket] of KEYWORDS) {
        if (pattern.test(item.title)) buckets.add(bucket);
    }
    return { score: buckets.size, buckets };
};

const isBaseTier = (item: NewsItem): boolean => item.tags.some((tag) => BASE_TIER_TAGS[tag]);

/**
 * Top 3: the bucketed stories first (score desc, then newest), padded with the
 * base tier (national / government) when fewer than 3 stories score.
 */
export const rankNewsItems = (items: NewsItem[], limit = 3): NewsItem[] => {
    const pool = items
        .filter((item) => item.buckets.length > 0 || isBaseTier(item))
        .sort((a, b) =>
            b.buckets.length - a.buckets.length || Date.parse(b.published) - Date.parse(a.published));
    return pool.slice(0, limit);
};
