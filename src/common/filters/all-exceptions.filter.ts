import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-codes';
import { serialize } from '../utils/serialize';

interface ErrorBody {
  success: false;
  message: string;
  code: string;
  details?: unknown;
  stack?: string;
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

/**
 * Single place that turns every thrown error into the documented error shape:
 * `{ success: false, message, code }`. Internal details (stack traces, Prisma
 * messages) are never sent to clients in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly exposeStack = false) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, body } = this.toResponse(exception);

    if (status >= 500) {
      this.logger.error(
        { err: exception, method: req.method, url: req.originalUrl, status },
        'Unhandled error',
      );
      if (this.exposeStack && exception instanceof Error) body.stack = exception.stack;
    } else if (status === 401 || status === 403) {
      this.logger.warn(
        { method: req.method, url: req.originalUrl, status, code: body.code, ip: req.ip },
        'Access denied',
      );
    }

    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        body: {
          success: false,
          message: exception.message,
          code: exception.code,
          ...(exception.details !== undefined && { details: serialize(exception.details) }),
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      let message = exception.message;
      if (typeof response === 'object' && response !== null && 'message' in response) {
        const m = response.message;
        message = Array.isArray(m) ? m.join('; ') : String(m);
      }
      if (status === 429) message = 'Too many requests, please try again later';
      return {
        status,
        body: {
          success: false,
          message,
          code:
            STATUS_TO_CODE[status] ??
            (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST),
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return this.simple(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'Resource already exists');
        case 'P2025':
          return this.simple(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Resource not found');
        case 'P2003':
          return this.simple(
            HttpStatus.CONFLICT,
            ErrorCode.CONFLICT,
            'Operation violates a relation constraint',
          );
      }
    }

    return this.simple(
      HttpStatus.INTERNAL_SERVER_ERROR,
      ErrorCode.INTERNAL_ERROR,
      'Internal server error',
    );
  }

  private simple(status: number, code: ErrorCode, message: string) {
    return { status, body: { success: false as const, message, code } };
  }
}
