import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload: unknown = exception instanceof HttpException ? exception.getResponse() : null;
    const details = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    const message = Array.isArray(details.message) ? details.message.map(String) : typeof details.message === 'string' ? details.message : exception instanceof HttpException ? exception.message : 'Internal server error';
    const error = typeof details.error === 'string' ? details.error : statusCode === 500 ? 'Internal Server Error' : 'HTTP Error';
    const body: ErrorBody = { statusCode, error, message, path: request.originalUrl ?? request.url, timestamp: new Date().toISOString() };
    response.status(statusCode).json(body);
  }
}
