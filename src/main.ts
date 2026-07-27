import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  app.enableCors();

  // Corpo grande: transmissões carregam áudio em base64.
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  // Serve a web app (Painel Operacional + PTT) a partir de /public.
  app.useStaticAssets(path.join(process.cwd(), 'public'));

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  new Logger('Bootstrap').log(`COMUNICA+ no ar em http://localhost:${port}`);
}

bootstrap();
