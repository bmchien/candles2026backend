import { applyDecorators, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Authentication is required by default (global JwtAuthGuard); this opts a route
 * out of it. Use only for catalog reads, auth and address lookup.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Anonymous requests are allowed, but a Bearer token, when sent, is validated as usual
 * (invalid/expired token -> 401) and `request.user` is set. Used by the cart, which
 * works for both guests and logged-in customers.
 */
export const OptionalAuth = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), SetMetadata(IS_OPTIONAL_AUTH_KEY, true));
