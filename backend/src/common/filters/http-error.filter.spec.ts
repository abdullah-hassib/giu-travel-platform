import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpErrorFilter } from './http-error.filter';

describe('HttpErrorFilter', () => {
  it('normalizes validation failures', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ originalUrl: '/api/example' }) }) } as unknown as ArgumentsHost;
    new HttpErrorFilter().catch(new BadRequestException(['bad field']), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, path: '/api/example', message: ['bad field'] }));
  });
  it('does not leak unexpected exception messages', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ url: '/api/test' }) }) } as unknown as ArgumentsHost;
    new HttpErrorFilter().catch(new Error('secret value'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, message: 'Internal server error' }));
  });
});
