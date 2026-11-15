import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/filters/http-error.filter';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.useGlobalFilters(new HttpErrorFilter());
  const config = new DocumentBuilder().setTitle('GIU Travel Platform API').setDescription('GIU Travel Platform: authentication/accounts vertical slice and remaining feature-module scaffolds').setVersion('0.1.0').addCookieAuth('giu_session', { type: 'apiKey', in: 'cookie', name: 'giu_session' }, 'giu_session').addCookieAuth('giu_refresh', { type: 'apiKey', in: 'cookie', name: 'giu_refresh' }, 'giu_refresh').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.PORT ?? 3000));
}
if (require.main === module) {
  void bootstrap();
}
