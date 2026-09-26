import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/api/vessels', async () => ({ message: 'Hello, world!' }));

  return app;
}
