import { ServiceUnavailableException } from '@nestjs/common';
import { Connection } from 'mongoose';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports process liveness', () => {
    const controller = new HealthController({ readyState: 0 } as Connection);
    expect(controller.live()).toEqual({ status: 'ok' });
  });
  it('rejects readiness when MongoDB is down', () => {
    const controller = new HealthController({ readyState: 0 } as Connection);
    expect(() => controller.ready()).toThrow(ServiceUnavailableException);
  });
  it('reports readiness when MongoDB is connected', () => {
    const controller = new HealthController({ readyState: 1 } as Connection);
    expect(controller.ready()).toEqual({ status: 'ok', database: 'connected' });
  });
});
