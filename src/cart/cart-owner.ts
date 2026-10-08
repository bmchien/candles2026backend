import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { AuthUser } from '../common/decorators/current-user.decorator';

/** Header carrying the guest cart token issued by POST /cart/items. */
export const CART_TOKEN_HEADER = 'x-cart-token';

/** 32 random bytes, base64url without padding. */
const CART_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Who a cart belongs to: a logged-in user, or a guest identified by a token (stored hashed). */
export type CartOwner = { kind: 'user'; userId: bigint } | { kind: 'guest'; tokenHash: string };

export const hashCartToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const newCartToken = () => randomBytes(32).toString('base64url');

export const userOwner = (userId: bigint): CartOwner => ({ kind: 'user', userId });

export function ownerWhere(owner: CartOwner): Prisma.CartWhereUniqueInput {
  return owner.kind === 'user' ? { userId: owner.userId } : { guestTokenHash: owner.tokenHash };
}

export function ownerData(owner: CartOwner): Prisma.CartUncheckedCreateInput {
  return owner.kind === 'user' ? { userId: owner.userId } : { guestTokenHash: owner.tokenHash };
}

/** The guest cart named by the X-Cart-Token header, or null when absent or malformed. */
export function guestOwnerFromRequest(req: Request): CartOwner | null {
  const token = req.headers[CART_TOKEN_HEADER];
  return typeof token === 'string' && CART_TOKEN_PATTERN.test(token)
    ? { kind: 'guest', tokenHash: hashCartToken(token) }
    : null;
}

/**
 * Resolves the cart owner of the request: the authenticated user if a valid JWT was sent
 * (a JWT always wins over a cart token), otherwise the guest token, otherwise null.
 */
export const CurrentCartOwner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CartOwner | null => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return req.user ? userOwner(req.user.id) : guestOwnerFromRequest(req);
  },
);

/** The guest cart token header of the request, hashed (null when absent). */
export const GuestCartOwner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CartOwner | null =>
    guestOwnerFromRequest(ctx.switchToHttp().getRequest<Request>()),
);
