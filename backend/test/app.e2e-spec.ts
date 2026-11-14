import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import { getConnectionToken } from '@nestjs/mongoose';

// No live Atlas needed: checks health HTTP route and Swagger document generation.
describe('Foundation HTTP (e2e, isolated)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [HealthController], providers: [{ provide: getConnectionToken(), useValue: { readyState: 1 } }] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('GIU API').setVersion('0.1.0').build()));
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  it('serves liveness', () => request(app.getHttpServer()).get('/api/health/live').expect(200).expect({ status: 'ok' }));
  it('serves Swagger UI', () => request(app.getHttpServer()).get('/api/docs').expect(200));
  it('serves OpenAPI JSON', () => request(app.getHttpServer()).get('/api/docs-json').expect(200));
});
