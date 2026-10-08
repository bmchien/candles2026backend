import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * Domain exception carrying a machine-readable `code`. Rendered by
 * AllExceptionsFilter as `{ success: false, message, code, details? }`.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ message, code, details }, status);
  }

  static notFound(code: ErrorCode, message: string): AppException {
    return new AppException(HttpStatus.NOT_FOUND, code, message);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown): AppException {
    return new AppException(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static conflict(code: ErrorCode, message: string, details?: unknown): AppException {
    return new AppException(HttpStatus.CONFLICT, code, message, details);
  }

  static unprocessable(code: ErrorCode, message: string, details?: unknown): AppException {
    return new AppException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  }
}
