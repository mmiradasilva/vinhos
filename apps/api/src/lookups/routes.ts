import type { FastifyInstance } from 'fastify';
import { LIMITS, normalizeForSearch } from '@cellar/shared';
import { requireAuth } from '../auth/session';
import type { AppContext } from '../context';

/** add-wine §8 lookup endpoints. Shared lists return public entries plus the user's own private ones (BR-14). */
export function registerLookupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const db = ctx.pool;
  const search = (raw: unknown) => {
    const q = typeof raw === 'string' ? normalizeForSearch(raw).slice(0, LIMITS.searchMax) : '';
    return { like: `%${q.replace(/[\\%_]/g, '\\$&')}%`, prefix: `${q.replace(/[\\%_]/g, '\\$&')}%` };
  };

  app.get('/colours', { preHandler: requireAuth }, async () => ({
    items: (await db.query('SELECT id, code, name FROM colour ORDER BY id')).rows,
  }));

  app.get('/bottle-sizes', { preHandler: requireAuth }, async () => ({
    items: (await db.query('SELECT id, volume_ml, name FROM bottle_size ORDER BY volume_ml')).rows,
  }));

  app.get('/countries', { preHandler: requireAuth }, async () => ({
    items: (await db.query('SELECT id, iso_code, name FROM country ORDER BY name')).rows,
  }));

  app.get('/regions', { preHandler: requireAuth }, async (req) => {
    const query = req.query as Record<string, unknown>;
    const { like, prefix } = search(query.q);
    const country = typeof query.country === 'string' && query.country ? query.country.toUpperCase() : null;
    const { rows } = await db.query(
      `SELECT r.id, r.name, json_build_object('id', co.id, 'iso_code', co.iso_code, 'name', co.name) AS country
         FROM region r JOIN country co ON co.id = r.country_id
        WHERE (r.is_public OR r.created_by = $1) AND r.name_norm LIKE $2
          AND ($4::text IS NULL OR co.iso_code = $4)
        ORDER BY (r.name_norm LIKE $3) DESC, r.name
        LIMIT ${LIMITS.lookupResultsMax}`,
      [req.auth!.userId, like, prefix, country],
    );
    return { items: rows };
  });

  for (const table of ['producer', 'grape'] as const) {
    app.get(`/${table}s`, { preHandler: requireAuth }, async (req) => {
      const { like, prefix } = search((req.query as Record<string, unknown>).q);
      const { rows } = await db.query(
        `SELECT id, name FROM ${table}
          WHERE (is_public OR created_by = $1) AND name_norm LIKE $2
          ORDER BY (name_norm LIKE $3) DESC, name
          LIMIT ${LIMITS.lookupResultsMax}`,
        [req.auth!.userId, like, prefix],
      );
      return { items: rows };
    });
  }
}
