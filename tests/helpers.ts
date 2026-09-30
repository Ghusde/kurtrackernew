import type { VercelRequest, VercelResponse } from '@vercel/node';

export type MockRes = VercelResponse & {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
};

export function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    }
  };
  return res as unknown as MockRes;
}

export const mockReq = (
  method: string,
  body?: unknown,
  query: Record<string, string> = {}
) => ({ method, body, query, url: '/api/test' }) as unknown as VercelRequest;
