import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import {
  PaymentIntentService,
  PaymentIntentRepository,
  MerchantConfigService,
  WebhookDeliveryService,
} from '@crypto-gateway/payment-intent';
import { intentRoutes } from './routes/intents.js';

const app = Fastify({
  logger: {
    level: process.env['LOG_LEVEL'] || 'info',
    transport:
      process.env['NODE_ENV'] !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

// ─── Plugins ─────────────────────────────────────────────────────────────────

await app.register(cors, {
  origin: process.env['CORS_ORIGINS']?.split(',') || ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

await app.register(helmet);

// ─── Initialize Services ─────────────────────────────────────────────────────

const merchantService = new MerchantConfigService();
const webhookService = new WebhookDeliveryService(merchantService);
const intentRepository = new PaymentIntentRepository();
const intentService = new PaymentIntentService(intentRepository, merchantService, webhookService);

// ─── Health Check ────────────────────────────────────────────────────────────

app.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'crypto-gateway-api',
    version: '0.1.0',
  };
});

app.get('/health/ready', async () => {
  // Check database connectivity
  try {
    const { healthCheck } = await import('@crypto-gateway/db');
    const dbHealthy = await healthCheck();
    return {
      status: dbHealthy ? 'ready' : 'not_ready',
      database: dbHealthy ? 'connected' : 'disconnected',
    };
  } catch {
    return { status: 'not_ready', database: 'error' };
  }
});

// ─── API Routes ──────────────────────────────────────────────────────────────

await app.register(async (instance) => {
  await intentRoutes(instance, intentService);
});

// ─── Error Handler ───────────────────────────────────────────────────────────

app.setErrorHandler((error, request, reply) => {
  app.log.error(error);

  const statusCode = (error as any).statusCode || 500;
  const code = (error as any).code || 'INTERNAL_ERROR';

  reply.status(statusCode).send({
    error: {
      code,
      message: error.message || 'An unexpected error occurred',
    },
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────

const start = async () => {
  const port = parseInt(process.env['PORT'] || '3000', 10);
  const host = process.env['HOST'] || '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`🚀 Crypto Gateway API running on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
