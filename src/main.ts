import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  configureApp(app);

  const port = app.get(ConfigService).get<number>('PORT', 3001);
  await app.listen(port);
  app.get(Logger).log(`API listening on http://localhost:${port} — docs at /docs`, 'Bootstrap');
}

void bootstrap();
