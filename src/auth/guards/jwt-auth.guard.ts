import { ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';

/**
 * Global guard: every route requires a valid Bearer JWT unless marked `@Public()`.
 * `@OptionalAuth()` routes accept anonymous requests but still validate a sent token.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      const optionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      const hasToken = !!context.switchToHttp().getRequest<Request>().headers.authorization;
      // @OptionalAuth(): authenticate only when credentials are actually sent.
      if (!optionalAuth || !hasToken) return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    if (err || !user) {
      const req = context.switchToHttp().getRequest<Request>();
      // Only the failure reason is logged, never the token itself.
      let reason = 'no user';
      if (info instanceof Error) reason = info.message;
      else if (err instanceof Error) reason = err.message;
      this.logger.warn(
        { method: req.method, url: req.originalUrl, ip: req.ip, reason },
        'Authentication failed',
      );
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
      );
    }
    return user;
  }
}
