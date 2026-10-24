// Screensaver paintings: public-domain works from the Art Institute of Chicago API (no key), refreshed daily.
import type { Logger } from 'pino';
import { z } from 'zod';
import type { TtlCache } from '../lib/cache.js';

const Search = z.object({
  data: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      artist_title: z.string().nullable(),
      date_display: z.string().nullable(),
      image_id: z.string().nullable(),
      thumbnail: z.object({ width: z.number().optional(), height: z.number().optional() }).nullable(),
    }),
  ),
});

export const PaintingSchema = z.object({
  title: z.string(),
  artist: z.string(),
  date: z.string(),
  url: z.string().describe('Image URL (IIIF, ~1686 px wide)'),
});
export type Painting = z.infer<typeof PaintingSchema>;

/** Landscape-oriented and big enough to fill a 1080p screen. */
const fitsScreen = (t: { width?: number; height?: number } | null) =>
  !!t?.width && !!t.height && t.width / t.height >= 1.15 && t.width >= 1600;

export function paintings(cache: TtlCache, queries: string[], log: Logger): Promise<Painting[]> {
  return cache.get(`art:${queries.join(',')}`, 24 * 3600_000, async () => {
    const out = new Map<number, Painting>();
    for (const q of queries) {
      const params = {
        q,
        limit: 40,
        fields: ['id', 'title', 'artist_title', 'date_display', 'image_id', 'thumbnail'],
        query: {
          bool: {
            filter: [{ term: { is_public_domain: true } }, { term: { 'artwork_type_title.keyword': 'Painting' } }],
          },
        },
      };
      try {
        const r = await fetch(
          `https://api.artic.edu/api/v1/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`,
          { headers: { 'AIC-User-Agent': 'tv-home screensaver' } },
        );
        for (const a of Search.parse(await r.json()).data) {
          if (!a.image_id || !fitsScreen(a.thumbnail)) continue;
          out.set(a.id, {
            title: a.title,
            artist: a.artist_title ?? '',
            date: a.date_display ?? '',
            url: `https://www.artic.edu/iiif/2/${a.image_id}/full/1686,/0/default.jpg`,
          });
        }
      } catch (err) {
        log.warn({ err, q }, 'art search failed');
      }
    }
    return [...out.values()];
  });
}
