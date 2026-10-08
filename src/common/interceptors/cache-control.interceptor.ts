import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';

const CACHE_CONTROL_KEY = 'cache-control';

/**
 * Marks a public read endpoint as cacheable by browsers/CDN for `maxAge` seconds
 * (HLD §8: HTTP cache + short TTL). Express adds a weak ETag automatically, so
 * conditional requests get 304 responses.
 */
export const HttpCache = (maxAge: number, staleWhileRevalidate = maxAge * 2) =>
  SetMetadata(
    CACHE_CONTROL_KEY,
    `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  );

@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const header = this.reflector.get<string | undefined>(CACHE_CONTROL_KEY, context.getHandler());
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => {
        res.setHeader('Cache-Control', header ?? 'no-store');
      }),
    );
  }
}
