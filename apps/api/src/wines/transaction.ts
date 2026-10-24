import type { Client, Pool } from '../db/pool';

export interface Outcome {
  status: number;
  body: unknown;
  location?: string;
}

/**
 * Runs `work` in a transaction; commits only on a 2xx outcome.
 * With an Idempotency-Key, a repeated request returns the first successful result (add-wine FR-9, view-edit-wine §8).
 */
export async function inTransaction(pool: Pool, userId: string, key: string | null, work: (db: Client) => Promise<Outcome>): Promise<Outcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (key) {
      const claimed = await client.query(
        'INSERT INTO idempotency_key (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key',
        [userId, key],
      );
      if (claimed.rowCount === 0) {
        // Another request with this key committed first; our insert waited for it, so its result is visible now.
        await client.query('ROLLBACK');
        const prev = await pool.query<{ status_code: number; body: { id?: string } }>(
          'SELECT status_code, body FROM idempotency_key WHERE user_id = $1 AND key = $2',
          [userId, key],
        );
        const row = prev.rows[0];
        return { status: row.status_code, body: row.body };
      }
    }
    const outcome = await work(client);
    if (outcome.status >= 300) {
      await client.query('ROLLBACK');
      return outcome;
    }
    if (key) {
      await client.query('UPDATE idempotency_key SET status_code = $3, body = $4 WHERE user_id = $1 AND key = $2', [
        userId,
        key,
        outcome.status,
        outcome.body === undefined ? null : JSON.stringify(outcome.body),
      ]);
    }
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
