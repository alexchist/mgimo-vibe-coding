import { createApp } from './app.mjs';

const app = createApp();
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Orbita listening on port ${port}; fictional demo data only.`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => {
      app.locals.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
