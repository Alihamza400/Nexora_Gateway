import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '@crypto-gateway/payment-intent';

/**
 * Auth Middleware
 * Validates API key or JWT token for protected routes.
 */

export interface AuthenticatedRequest extends FastifyRequest {
  merchant?: {
    id: string;
    name: string;
    email: string;
    compliance_status: string;
  };
}

/**
 * Create auth middleware that validates API key or token.
 */
export function createAuthMiddleware(authService: AuthService) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
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
      reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid API key or token required. Provide X-API-Key header or Authorization: Bearer <token>',
        },
      });
      return;
    }

    // Attach merchant to request for downstream use
    (request as AuthenticatedRequest).merchant = {
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      compliance_status: merchant.compliance_status,
    };
  };
}

/**
 * Middleware that requires COMPLIANT status.
 */
export function requireCompliant(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const merchant = (request as AuthenticatedRequest).merchant;

  if (merchant?.compliance_status !== 'COMPLIANT') {
    reply.status(403).send({
      error: {
        code: 'NOT_COMPLIANT',
        message: 'Merchant account is not compliant. Please complete KYC verification.',
      },
    });
  }
}
