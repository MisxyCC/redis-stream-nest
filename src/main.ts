import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  // สร้าง instance โดยระบุให้ใช้ FastifyAdapter
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }), // สามารถเปิด logger ของ Fastify ได้ถ้าต้องการดู Log ระดับ HTTP แบบละเอียด
  );

  // เปิด CORS เพื่อให้ Frontend (Vue) เรียก API ได้
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  // ข้อควรระวัง: Fastify ต้องระบุ Host เป็น '0.0.0.0' เพื่อให้สามารถรับ Request จากภายนอก (เช่น Docker หรือ Frontend คนละ Port) ได้
  await app.listen(3000, '0.0.0.0');
  console.log(`NestJS (Fastify) is running on: ${await app.getUrl()}`);
}
bootstrap();
