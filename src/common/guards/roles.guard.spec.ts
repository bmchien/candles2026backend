import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AppException } from '../exceptions/app.exception';
import { RolesGuard } from './roles.guard';

const contextFor = (user?: { id: bigint; role: Role }): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard (admin authorization)', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  afterEach(() => jest.restoreAllMocks());

  it('allows routes without @Roles metadata', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextFor({ id: 1n, role: Role.CUSTOMER }))).toBe(true);
  });

  it('allows an ADMIN on an admin route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    expect(guard.canActivate(contextFor({ id: 1n, role: Role.ADMIN }))).toBe(true);
  });

  it('rejects a CUSTOMER on an admin route with 403', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    try {
      guard.canActivate(contextFor({ id: 2n, role: Role.CUSTOMER }));
      fail('expected an exception');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).getStatus()).toBe(403);
      expect((e as AppException).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a request without a user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(AppException);
  });
});
