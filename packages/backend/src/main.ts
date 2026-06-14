import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  const port = process.env.BACKEND_PORT || 3000;
  await app.listen(port);

  console.log(`[Vessel Sloshing Monitor] Backend running on port ${port}`);
  console.log(`[Vessel Sloshing Monitor] WebSocket running on port ${process.env.WEBSOCKET_PORT || 3001}`);
}

bootstrap();
