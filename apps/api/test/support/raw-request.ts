/**
 * One HTTP request with exactly the given headers (node:http). With `body`
 * undefined no body byte is sent, so a declared Content-Length or a chunked
 * encoding is answered on the headers alone (SEC-02 body cap).
 */
import { request } from 'node:http';

export interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

export function rawRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
      );
    });
    req.on('error', reject);
    if (body === undefined) {
      req.flushHeaders();
    } else {
      req.end(body);
    }
  });
}
