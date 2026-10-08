import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './common/decorators/public.decorator';
import { AppException } from './common/exceptions/app.exception';
import { ErrorCode } from './common/exceptions/error-codes';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness + database connectivity check (for load balancers)' })
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Database unavailable',
      );
    }
    return { status: 'ok', timestamp: new Date() };
  }
}
