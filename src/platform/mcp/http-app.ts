import type { Server } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Principal } from '../auth/principal.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import { toSanitizedError } from '../errors/sanitized-error.js';
import type { Logger } from '../logging/logger.js';

export interface HttpAppDeps {
  verifier: TokenVerifier;
  /** Builds a fresh server for the authenticated principal (the HTTP mode is stateless). */
  buildServer: (principal: Principal) => McpServer;
  logger: Logger;
}

const PRINCIPAL_KEY = 'principal';

function fail(res: Response, status: number, error: unknown): void {
  const sanitized = toSanitizedError(error);
  res.status(status).json({ error: sanitized.toJSON() });
}

/**
 * Express app with `/health` (open, no data) and `/mcp` (authenticated on every request, never
 * exposed without a verified principal).
 */
export function createHttpApp({ verifier, buildServer, logger }: HttpAppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    verifier.verify(req.headers).then(
      (principal) => {
        res.locals[PRINCIPAL_KEY] = principal;
        next();
      },
      (error: unknown) => {
        logger.warn('request rejected', { event: 'auth', code: toSanitizedError(error).code });
        res.setHeader('WWW-Authenticate', 'Bearer');
        fail(res, 401, error);
      },
    );
  };

  app.all('/mcp', authenticate);

  app.post('/mcp', express.json({ limit: '64kb' }), async (req, res) => {
    const principal = res.locals[PRINCIPAL_KEY] as Principal;
    const server = buildServer(principal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('mcp request failed', { event: 'mcp', code: toSanitizedError(error).code });
      if (!res.headersSent) fail(res, 500, error);
    }
  });

  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: { code: 'BAD_METHOD', message: 'Use POST for /mcp.' } });
  });

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = (error as { status?: number }).status === 413 ? 413 : 400;
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } });
  };
  app.use(onError);

  return app;
}

export function listen(app: Express, port: number, host = '0.0.0.0'): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve(server);
    });
    server.once('error', reject);
  });
}
