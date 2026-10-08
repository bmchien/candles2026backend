import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Cross-cutting admin features (dashboard). Admin CRUD endpoints for a domain
 * live next to that domain (e.g. products/admin-products.controller.ts) so the
 * business rules stay in one service.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
