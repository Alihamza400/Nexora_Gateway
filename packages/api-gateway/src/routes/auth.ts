import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuthService, RegisterRequest, LoginRequest } from '@crypto-gateway/payment-intent';

/**
 * Auth API Routes
 *
 * POST /api/v1/auth/register  - Register a new merchant
 * POST /api/v1/auth/login     - Login with email and password
 * GET  /api/v1/auth/profile   - Get merchant profile (requires API key)
 * POST /api/v1/auth/regenerate-key - Regenerate API key (requires API key)
 */

export function authRoutes(
  app: FastifyInstance,
  authService: AuthService,
): void {
  /**
   * Register a new merchant.
   *
   * @example POST /api/v1/auth/register
   * {
   *   "name": "My Store",
   *   "email": "merchant@example.com",
   *   "password": "securepassword123",
   *   "settlement_asset": "USDC",
   *   "settlement_chain": "8453",
   *   "settlement_address": "0x...",
   *   "accepted_chains": ["1", "8453"],
   *   "accepted_assets": ["USDC", "USDT"],
   *   "webhook_url": "https://myapp.com/webhook"
   * }
   */
  app.post('/api/v1/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as RegisterRequest;

    try {
      const result = await authService.register(body);

      return reply.status(201).send({
        success: true,
        data: {
          merchant_id: result.merchant_id,
          name: result.name,
          email: result.email,
          api_key: result.api_key,
          token: result.token,
        },
        message: 'Registration successful. Save your API key securely - it will not be shown again.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';

      if (message.includes('already registered')) {
        return reply.status(409).send({
          error: {
            code: 'EMAIL_EXISTS',
            message,
          },
        });
      }

      if (message.includes('required') || message.includes('at least')) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message,
          },
        });
      }

      return reply.status(500).send({
        error: {
          code: 'REGISTRATION_FAILED',
          message: 'Failed to register merchant',
        },
      });
    }
  });

  /**
   * Login with email and password.
   *
   * @example POST /api/v1/auth/login
   * {
   *   "email": "merchant@example.com",
   *   "password": "securepassword123"
   * }
   */
  app.post('/api/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as LoginRequest;

    try {
      const result = await authService.login(body);

      return reply.send({
        success: true,
        data: {
          merchant_id: result.merchant_id,
          name: result.name,
          email: result.email,
          token: result.token,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';

      if (message.includes('Invalid')) {
        return reply.status(401).send({
          error: {
            code: 'INVALID_CREDENTIALS',
            message,
          },
        });
      }

      return reply.status(500).send({
        error: {
          code: 'LOGIN_FAILED',
          message: 'Failed to login',
        },
      });
    }
  });

  /**
   * Get merchant profile (requires API key or token).
   *
   * @example GET /api/v1/auth/profile
   * Headers: X-API-Key: nxt_... or Authorization: Bearer ...
   */
  app.get('/api/v1/auth/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-api-key'] as string;
    const authHeader = request.headers['authorization'] as string;

    let merchant = null;

    if (apiKey) {
      merchant = await authService.validateApiKey(apiKey);
    } else if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      merchant = await authService.validateToken(token);
    }

    if (!merchant) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid API key or token required',
        },
      });
    }

    const profile = await authService.getProfile(merchant.id);

    return reply.send({
      success: true,
      data: profile,
    });
  });

  /**
   * Regenerate API key (requires API key).
   *
   * @example POST /api/v1/auth/regenerate-key
   * Headers: X-API-Key: nxt_...
   */
  app.post('/api/v1/auth/regenerate-key', async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-api-key'] as string;

    if (!apiKey) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key required',
        },
      });
    }

    const merchant = await authService.validateApiKey(apiKey);

    if (!merchant) {
      return reply.status(401).send({
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid API key',
        },
      });
    }

    const newApiKey = await authService.regenerateApiKey(merchant.id);

    return reply.send({
      success: true,
      data: {
        api_key: newApiKey,
      },
      message: 'API key regenerated. Update your integrations with the new key.',
    });
  });
}
