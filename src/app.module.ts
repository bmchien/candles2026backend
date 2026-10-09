import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AddressModule } from './address/address.module';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CartModule } from './cart/cart.module';
import { CategoriesModule } from './categories/categories.module';
import { CacheModule } from './common/cache/cache.module';
import { RolesGuard } from './common/guards/roles.guard';
import { NodeEnv, validateEnv } from './config/env.validation';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { ScentsModule } from './scents/scents.module';
import { TagsModule } from './tags/tags.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),

    // Structured JSON logs (pretty-printed in development). Secrets are redacted.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const env = config.get<NodeEnv>('NODE_ENV');
        return {
          pinoHttp: {
            level: env === NodeEnv.Test ? 'silent' : config.get<string>('LOG_LEVEL', 'info'),
            genReqId: (req, res) => {
              const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-cart-token"]',
                'res.headers["set-cookie"]',
                '*.password',
                '*.passwordHash',
                '*.access_token',
                '*.guest_token',
              ],
              censor: '[REDACTED]',
            },
            serializers: {
              req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
                ip: req.remoteAddress,
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            customLogLevel: (_req, res, err) =>
              err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
            autoLogging: { ignore: (req) => req.url === '/health' },
            transport:
              env === NodeEnv.Development
                ? {
                    target: 'pino-pretty',
                    options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
                  }
                : undefined,
          },
        };
      },
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.get<number>('THROTTLE_TTL', 60_000),
          limit: config.get<number>('THROTTLE_LIMIT', 120),
        },
      ],
    }),

    PrismaModule,
    CacheModule,
    UsersModule,
    AuthModule,
    CategoriesModule,
    TagsModule,
    ScentsModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    AddressModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    // Order matters: rate limit -> authenticate -> authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
