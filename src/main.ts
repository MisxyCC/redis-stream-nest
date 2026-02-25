import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  // บังคับใช้ Validation กับทุก Request ที่มี DTO
  // whitelist: true คือการปัดทิ้งฟิลด์ขยะที่ไม่ได้อยู่ใน DTO อัตโนมัติ
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(3000, '0.0.0.0');
  console.log(`Backend is running at ${await app.getUrl()}`);
}
bootstrap().catch((err) => {
  console.error(err);
});
