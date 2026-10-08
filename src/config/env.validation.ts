import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Environment schema. The app refuses to boot when a required variable is
 * missing or malformed, so misconfiguration fails fast instead of at runtime.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(16, { message: 'JWT_SECRET must be at least 16 characters long' })
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN = '7d';

  /** Comma-separated list of allowed origins. */
  @IsString()
  @IsOptional()
  FRONTEND_URL = 'http://localhost:3000';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT = 3001;

  @IsUrl({ require_tld: false })
  @IsOptional()
  APP_URL?: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1000)
  @IsOptional()
  THROTTLE_TTL = 60_000;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @IsOptional()
  THROTTLE_LIMIT = 120;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @IsOptional()
  AUTH_THROTTLE_LIMIT = 10;

  @IsString()
  @IsOptional()
  UPLOAD_DIR = 'uploads';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  UPLOAD_MAX_SIZE_MB = 5;

  @IsUrl({ require_tld: false })
  @IsOptional()
  ADDRESS_API_BASE_URL = 'https://provinces.open-api.vn/api/v2';

  @IsString()
  @IsOptional()
  LOG_LEVEL = 'info';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  if (validated.NODE_ENV === NodeEnv.Production && validated.JWT_SECRET === 'change-me') {
    throw new Error('JWT_SECRET must be changed in production');
  }
  return validated;
}
