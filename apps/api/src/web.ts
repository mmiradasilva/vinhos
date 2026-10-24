import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Production: the API also serves the built web app, so both share one origin (sign-in Q15).
 * Hashed assets are cached for a year; everything else, including index.html, is revalidated.
 */
export async function registerWebApp(app: FastifyInstance, distDir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    cacheControl: false,
    setHeaders: (res, filePath) => {
      const immutable = /[\\/]assets[\\/]/.test(filePath);
      res.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  // Client-side routes (/collection, /collection/wines/…) all load index.html; unknown API paths stay JSON 404s.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ code: 'not_found' });
  });
}
