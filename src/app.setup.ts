import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppException } from './common/exceptions/app.exception';
import { ErrorCode } from './common/exceptions/error-codes';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CacheControlInterceptor } from './common/interceptors/cache-control.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { NodeEnv } from './config/env.validation';

function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): { field: string; errors: string[] }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, errors: Object.values(e.constraints) }] : [];
    return [...own, ...flattenValidationErrors(e.children ?? [], field)];
  });
}

/**
 * Applies security, validation, response shaping and docs. Shared by main.ts
 * and the e2e tests so both run exactly the same HTTP pipeline.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const isProd = config.get<NodeEnv>('NODE_ENV') === NodeEnv.Production;

  // Behind a load balancer / reverse proxy: use X-Forwarded-For for rate limiting and logs.
  app.set('trust proxy', config.get<string>('TRUST_PROXY') ? Number(config.get('TRUST_PROXY')) : 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Swagger UI needs inline scripts/styles; the API itself only serves JSON.
      contentSecurityPolicy: isProd ? undefined : false,
    }),
  );

  const origins = config
    .get<string>('FRONTEND_URL', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Cart-Token'],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    maxAge: 600,
  });

  app.useBodyParser('json', { limit: '1mb' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
      exceptionFactory: (errors) => {
        const details = flattenValidationErrors(errors);
        const message = details.flatMap((d) => d.errors).join('; ') || 'Validation failed';
        return new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          message,
          details,
        );
      },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(!isProd));
  app.useGlobalInterceptors(
    new CacheControlInterceptor(app.get(Reflector)),
    new TransformInterceptor(),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('E-commerce API')
    .setDescription(
      'REST API for the e-commerce storefront and admin panel.\n\n' +
        'Success: `{ success: true, data }` (lists add `pagination`). ' +
        'Error: `{ success: false, message, code }`.\n\n' +
        'Authenticate with `POST /auth/login`, then click **Authorize** and paste the `access_token`.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
}
