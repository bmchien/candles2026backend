import { JwtService } from '@nestjs/jwt';
import {
  bearer,
  createTestApp,
  loginAdmin,
  registerCustomer,
  resetDatabase,
  seedFixtures,
  TestContext,
} from './helpers';

describe('Auth, JWT and RBAC (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx);
    await seedFixtures(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('POST /auth/register', () => {
    it('creates a CUSTOMER and returns { access_token, user } without the password hash', async () => {
      const res = await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'Nguyễn Văn An', email: '  An.Nguyen@Example.com ', password: 'Password1' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.access_token).toEqual(expect.any(String));
      expect(res.body.data.user).toEqual({
        id: expect.any(Number),
        name: 'Nguyễn Văn An',
        email: 'an.nguyen@example.com',
        role: 'CUSTOMER',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const stored = await ctx.prisma.user.findUnique({
        where: { email: 'an.nguyen@example.com' },
      });
      expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('rejects a duplicate email with 409', async () => {
      const res = await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'Ai đó', email: 'an.nguyen@example.com', password: 'Password1' })
        .expect(409);
      expect(res.body).toEqual({
        success: false,
        message: expect.any(String),
        code: 'EMAIL_ALREADY_EXISTS',
      });
    });

    it('validates input (400 VALIDATION_ERROR)', async () => {
      const res = await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'A', email: 'not-an-email', password: 'short' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'email',
        'name',
        'password',
      ]);
    });

    it('cannot self-assign the ADMIN role (unknown fields are rejected)', async () => {
      await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'Hacker', email: 'h@example.com', password: 'Password1', role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('returns a token for valid credentials', async () => {
      const res = await ctx
        .http()
        .post('/auth/login')
        .send({ email: 'AN.NGUYEN@example.com', password: 'Password1' })
        .expect(200);
      expect(res.body.data.user.email).toBe('an.nguyen@example.com');
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password with 401', async () => {
      const res = await ctx
        .http()
        .post('/auth/login')
        .send({ email: 'an.nguyen@example.com', password: 'Wrong1234' })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects an unknown email with the same 401', async () => {
      const res = await ctx
        .http()
        .post('/auth/login')
        .send({ email: 'ghost@example.com', password: 'Password1' })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('JWT authentication', () => {
    it('requires a token on protected routes', async () => {
      const res = await ctx.http().get('/orders').expect(401);
      expect(res.body).toEqual({
        success: false,
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects a malformed or tampered token', async () => {
      await ctx.http().get('/users/me').set(bearer('not.a.jwt')).expect(401);
      const { token } = await registerCustomer(ctx, 'tamper@example.com');
      const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
      await ctx.http().get('/users/me').set(bearer(tampered)).expect(401);
    });

    it('rejects a token signed with another secret or already expired', async () => {
      const foreign = new JwtService({ secret: 'some-other-secret-0123456789' }).sign({
        sub: '1',
        role: 'ADMIN',
      });
      await ctx.http().get('/users/me').set(bearer(foreign)).expect(401);

      const expired = new JwtService({ secret: process.env.JWT_SECRET }).sign(
        { sub: '1', role: 'ADMIN' },
        { expiresIn: -10 },
      );
      await ctx.http().get('/users/me').set(bearer(expired)).expect(401);
    });

    it('rejects a valid token whose user no longer exists', async () => {
      const ghost = new JwtService({ secret: process.env.JWT_SECRET }).sign({
        sub: '999999',
        role: 'CUSTOMER',
      });
      await ctx.http().get('/users/me').set(bearer(ghost)).expect(401);
    });

    it('accepts a valid token', async () => {
      const { token } = await registerCustomer(ctx, 'valid@example.com', 'Trần Thị Bình');
      const res = await ctx.http().get('/users/me').set(bearer(token)).expect(200);
      expect(res.body.data).toEqual({
        id: expect.any(Number),
        name: 'Trần Thị Bình',
        email: 'valid@example.com',
        role: 'CUSTOMER',
      });
    });

    it('cart allows guests but still rejects an invalid token that is sent', async () => {
      await ctx.http().get('/cart').expect(200);
      await ctx.http().get('/cart').set(bearer('not.a.jwt')).expect(401);
      await ctx.http().post('/cart/merge').expect(401);
    });

    it('leaves public catalog routes open', async () => {
      await ctx.http().get('/products').expect(200);
      await ctx.http().get('/categories').expect(200);
      await ctx.http().get('/tags').expect(200);
    });
  });

  describe('Admin authorization (RBAC)', () => {
    const adminRoutes: [method: 'get' | 'post' | 'put' | 'delete', path: string][] = [
      ['get', '/admin/products'],
      ['post', '/admin/products'],
      ['get', '/admin/orders'],
      ['put', '/admin/orders/1/status'],
      ['post', '/admin/categories'],
      ['delete', '/admin/tags/1'],
      ['get', '/admin/dashboard'],
    ];

    it.each(adminRoutes)('%s %s returns 403 for a CUSTOMER', async (method, path) => {
      const { token } = await registerCustomer(
        ctx,
        `rbac-${method}-${path.replace(/\W/g, '')}@example.com`,
      );
      const res = await ctx.http()[method](path).set(bearer(token)).send({}).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it.each(adminRoutes)('%s %s returns 401 without a token', async (method, path) => {
      await ctx.http()[method](path).send({}).expect(401);
    });

    it('allows an ADMIN', async () => {
      const token = await loginAdmin(ctx);
      await ctx.http().get('/admin/products').set(bearer(token)).expect(200);
      await ctx.http().get('/admin/dashboard').set(bearer(token)).expect(200);
    });
  });
});
