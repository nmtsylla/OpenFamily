import assert from 'node:assert/strict';
import test from 'node:test';
import { NewsItem, parseNewsFeed, rankNewsItems, scoreNewsItem } from '../src/custom/lib/news.custom';

// One fixture entry that exercises every parsed field, with one nstag that
// maps to `family` and a title keyword that maps to `health`.
const FIXTURE_ENTRY = `<entry><title type="text"><![CDATA[Meer personeel nodig in de zorg rond de peuterschool]]></title><id>https://vrtnws.be/p.abCdEf</id><published>2026-10-14T10:00:00.000Z</published><updated>2026-10-14T10:00:00.000Z</updated><summary type="text"><![CDATA[De school vraagt meer middelen &amp; steun.]]></summary><vrtns:nstag xmlns="">Onderwijs</vrtns:nstag><vrtns:nstag xmlns="">Zorg</vrtns:nstag><link href="https://www.vrt.be/vrtnws/nl/2026/10/14/zorg-peuterschool.rss.xml" rel="self" type="application/atom+xml"/><link href="https://vrtnws.be/p.abCdEf" rel="alternate" type="text/html"/></entry>`;

// Mirrors what parseNewsFeed does: the buckets always come from the scorer.
const item = (partial: Partial<NewsItem> & Pick<NewsItem, 'title'>): NewsItem => {
    const base = { summary: '', published: '2026-10-14T08:00:00.000Z', link: '', tags: [] as string[], ...partial };
    return { ...base, buckets: [...scoreNewsItem(base).buckets] };
};

test('parseNewsFeed reads title, summary (CDATA-stripped), published, alternate link and nstags', () => {
    const [parsed] = parseNewsFeed(`<feed>${FIXTURE_ENTRY}</feed>`);
    assert.equal(parsed.title, 'Meer personeel nodig in de zorg rond de peuterschool');
    assert.equal(parsed.summary, 'De school vraagt meer middelen & steun.');
    assert.equal(parsed.published, '2026-10-14T10:00:00.000Z');
    assert.equal(parsed.link, 'https://vrtnws.be/p.abCdEf');
    assert.deepEqual(parsed.tags, ['Onderwijs', 'Zorg']);
    assert.deepEqual(parsed.buckets, ['family', 'health']);
});

test('parseNewsFeed drops entries without a usable title or date', () => {
    const xml = '<feed><entry><summary>no title</summary><published>2026-10-14T10:00:00.000Z</published></entry>'
        + '<entry><title>x</title><published>not-a-date</published></entry></feed>';
    assert.deepEqual(parseNewsFeed(xml), []);
});

test('scoreNewsItem maps Technologie & Wetenschap to tech', () => {
    const { score, buckets } = scoreNewsItem(item({ title: 'iets', tags: ['Technologie & Wetenschap'] }));
    assert.equal(score, 1);
    assert.deepEqual([...buckets], ['tech']);
});

test('title keywords hit their buckets', () => {
    assert.ok(scoreNewsItem(item({ title: 'Nieuwe peuterschool opent' })).buckets.has('family'));
    assert.ok(scoreNewsItem(item({ title: 'Meer zorg voor thuisverpleging' })).buckets.has('health'));
    assert.ok(scoreNewsItem(item({ title: 'Ontslagvergoeding stijgt' })).buckets.has('work'));
    assert.ok(scoreNewsItem(item({ title: 'Ouderschapsverlof verlengd' })).buckets.has('family'));
    assert.ok(scoreNewsItem(item({ title: 'Herhaling kindgebeuren' })).buckets.has('family'));
});

test('rankNewsItems sorts by bucket count, then newest first', () => {
    const ranked = rankNewsItems([
        item({ title: 'Zorg x', tags: ['Zorg'], published: '2026-10-14T09:00:00.000Z' }),
        item({ title: 'Zorg werk', tags: ['Zorg', 'Werk'], published: '2026-10-14T08:00:00.000Z' }),
        item({ title: 'Zorg nieuwer', tags: ['Zorg'], published: '2026-10-14T10:00:00.000Z' }),
        item({ title: 'Buitenland', tags: ['Buitenland'] }),
    ]);
    assert.deepEqual(ranked.map((r) => r.title), ['Zorg werk', 'Zorg nieuwer', 'Zorg x']);
});

test('rankNewsItems keeps Binnenland/Politiek even without buckets and pads to 3', () => {
    const ranked = rankNewsItems([
        item({ title: 'Tech', tags: ['Technologie & Wetenschap'], published: '2026-10-14T09:00:00.000Z' }),
        item({ title: 'Nationaal', tags: ['Binnenland'], published: '2026-10-14T08:00:00.000Z' }),
        item({ title: 'Regering', tags: ['Politiek'], published: '2026-10-14T07:00:00.000Z' }),
        item({ title: 'Buitenland', tags: ['Buitenland'], published: '2026-10-14T06:00:00.000Z' }),
    ]);
    assert.deepEqual(ranked.map((r) => r.title), ['Tech', 'Nationaal', 'Regering']);
});

test('rankNewsItems caps at 3 items', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
        item({ title: 'Zorg werk school cyber', published: `2026-10-14T0${i}:00:00.000Z` }));
    assert.equal(rankNewsItems(many).length, 3);
});
