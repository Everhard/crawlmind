import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EXTERNAL_ROUTES, SITE_ROUTES, type Route } from '../fixtures/site/routes.js';

const PAGES_DIR = new URL('../fixtures/site/pages/', import.meta.url);

export interface FixtureServer {
  origin: string;
  /** Requests received, as `METHOD path`. */
  requests: string[];
  /** Replace or add routes while the server runs (e.g. to simulate a site change). */
  routes: Record<string, Route>;
  close(): Promise<void>;
}

function listen(server: Server, host: string): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://${host}:${port}`);
    });
  });
}

export async function serve(
  host: string,
  initialRoutes: Record<string, Route>,
  vars: () => Record<string, string>,
): Promise<FixtureServer> {
  const routes = { ...initialRoutes };
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    requests.push(`${req.method} ${path}`);
    const route = routes[path];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
      return;
    }
    if (path === '/head-not-allowed' && req.method === 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const headers: Record<string, string> = {
      'content-type': 'text/html; charset=utf-8',
      ...route.headers,
    };
    if (route.location) headers.location = route.location;
    let body =
      route.body ?? (route.file ? readFileSync(new URL(route.file, PAGES_DIR), 'utf8') : '');
    for (const [key, value] of Object.entries(vars())) body = body.replaceAll(`{{${key}}}`, value);
    const send = () =>
      res.writeHead(route.status ?? 200, headers).end(req.method === 'HEAD' ? undefined : body);
    if (route.delayMs) setTimeout(send, route.delayMs);
    else send();
  });
  const origin = await listen(server, host);
  return {
    origin,
    requests,
    routes,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * Starts the fixture site on 127.0.0.1 and an "external" site on localhost.
 * Different hostnames make links between them external.
 */
export async function startFixtureSites(): Promise<{
  site: FixtureServer;
  external: FixtureServer;
  close(): Promise<void>;
}> {
  let siteOrigin = '';
  let externalOrigin = '';
  const vars = () => ({ origin: siteOrigin, external: externalOrigin });
  const external = await serve('localhost', EXTERNAL_ROUTES, vars);
  externalOrigin = external.origin;
  const site = await serve('127.0.0.1', SITE_ROUTES, vars);
  siteOrigin = site.origin;
  return {
    site,
    external,
    close: async () => {
      await Promise.all([site.close(), external.close()]);
    },
  };
}
