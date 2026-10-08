import { Module } from '@nestjs/common';
import { AdminProductsController } from './admin-products.controller';
import { ProductsImportService } from './products-import.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, AdminProductsController],
  providers: [ProductsService, ProductsImportService],
  exports: [ProductsService],
})
export class ProductsModule {}
