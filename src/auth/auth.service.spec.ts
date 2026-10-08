import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

describe('AuthService', () => {
  const jwt = new JwtService({
    secret: 'unit-test-secret-1234567890',
    signOptions: { expiresIn: '1h' },
  });
  let users: jest.Mocked<Pick<UsersService, 'findByEmailWithPassword' | 'create'>>;
  let service: AuthService;

  beforeEach(() => {
    users = { findByEmailWithPassword: jest.fn(), create: jest.fn() };
    service = new AuthService(users as unknown as UsersService, jwt);
  });

  describe('register', () => {
    it('hashes the password, creates a CUSTOMER and returns a token without the hash', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);
      users.create.mockImplementation(async (data) => ({
        id: 7n,
        name: data.name,
        email: data.email,
        role: Role.CUSTOMER,
      }));

      const result = await service.register({
        name: 'An',
        email: 'an@example.com',
        password: 'Secret123',
      });

      const created = users.create.mock.calls[0][0];
      expect(created.passwordHash).toMatch(/^\$argon2id\$/);
      expect(created.passwordHash).not.toContain('Secret123');
      expect(result.user).toEqual({
        id: 7n,
        name: 'An',
        email: 'an@example.com',
        role: Role.CUSTOMER,
      });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(jwt.verify(result.access_token)).toMatchObject({ sub: '7', role: Role.CUSTOMER });
    });

    it('rejects an email that is already registered (409)', async () => {
      users.findByEmailWithPassword.mockResolvedValue({ id: 1n } as never);
      await expect(
        service.register({ name: 'An', email: 'an@example.com', password: 'Secret123' }),
      ).rejects.toMatchObject({
        code: 'EMAIL_ALREADY_EXISTS',
        status: 409,
      });
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    let storedHash: string;
    beforeAll(async () => {
      storedHash = await hashPassword('Secret123');
    });

    const storedUser = () => ({
      id: 3n,
      name: 'Admin',
      email: 'admin@example.com',
      role: Role.ADMIN,
      passwordHash: storedHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('returns { access_token, user } for valid credentials', async () => {
      users.findByEmailWithPassword.mockResolvedValue(storedUser());
      const result = await service.login({ email: 'admin@example.com', password: 'Secret123' });
      expect(result.user).toEqual({
        id: 3n,
        name: 'Admin',
        email: 'admin@example.com',
        role: Role.ADMIN,
      });
      expect(jwt.verify(result.access_token)).toMatchObject({ sub: '3', role: Role.ADMIN });
    });

    it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
      users.findByEmailWithPassword.mockResolvedValue(storedUser());
      const err = await service
        .login({ email: 'admin@example.com', password: 'wrong-pass1' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).getStatus()).toBe(401);
      expect((err as AppException).code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects an unknown email with the same error', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nobody@example.com', password: 'Secret123' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });
  });
});
