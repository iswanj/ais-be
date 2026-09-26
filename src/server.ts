import { buildApp } from './app.js';

const app = buildApp();

const port = Number(process.env.PORT ?? 3000);

app.listen({ host: '0.0.0.0', port }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
