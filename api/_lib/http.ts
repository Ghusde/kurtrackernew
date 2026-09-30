import type { VercelRequest, VercelResponse } from '@vercel/node';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Route = (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown;

/**
 * Wraps a set of per-method handlers into a single Vercel function:
 * method dispatch, 405 for anything unmapped, and a catch-all 500 so a thrown
 * error never leaks a stack trace to the client.
 */
export function createHandler(routes: Partial<Record<Method, Route>>) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    // Financial data must never be served from a CDN or browser cache.
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    const method = (req.method ?? 'GET').toUpperCase() as Method;
    const route = routes[method];
    if (!route) {
      res.setHeader('Allow', Object.keys(routes).join(', '));
      res.status(405).json({ error: `Method ${method} not allowed.` });
      return;
    }

    try {
      await route(req, res);
    } catch (error) {
      console.error(`[api] ${method} ${req.url} failed`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  };
}

/** Vercel parses JSON bodies already, but be defensive about strings/empty. */
export function readBody<T extends Record<string, unknown>>(req: VercelRequest): Partial<T> {
  const raw = req.body;
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Partial<T>;
    } catch {
      return {};
    }
  }
  return raw as Partial<T>;
}

export function param(req: VercelRequest, name: string): string {
  const value = req.query[name];
  return Array.isArray(value) ? value[0] : value ?? '';
}
