import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType, ProductStatus } from '@prisma/client';

export class CategorySummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Điện thoại' })
  name: string;

  @ApiProperty({ example: 'dien-thoai' })
  slug: string;
}

export class TagSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Bán chạy' })
  name: string;

  @ApiProperty({ example: 'ban-chay' })
  slug: string;
}

export class ProductImageDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'https://cdn.example.com/products/ip15-1.jpg' })
  url: string;

  @ApiProperty({ example: 0 })
  position: number;
}

export class DiscountDto {
  @ApiProperty({ enum: DiscountType })
  type: DiscountType;

  @ApiProperty({ example: 10 })
  value: number;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  start: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  end: Date | null;

  @ApiProperty({ description: 'Whether the discount applies right now (server time)' })
  is_active: boolean;

  @ApiProperty({ description: 'price - final_price', example: 2999000 })
  amount: number;
}

export class ProductListItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'IP15-128-BLK' })
  code: string;

  @ApiProperty({ example: 'iPhone 15 128GB Đen' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  short_description: string | null;

  @ApiProperty({ description: 'Base price', example: 22990000 })
  price: number;

  @ApiProperty({ description: 'Price after the currently valid discount', example: 20691000 })
  final_price: number;

  @ApiProperty({ type: DiscountDto })
  discount: DiscountDto;

  @ApiProperty({ type: CategorySummaryDto })
  category: CategorySummaryDto;

  @ApiProperty({ type: [TagSummaryDto] })
  tags: TagSummaryDto[];

  @ApiProperty({ type: [ProductImageDto] })
  images: ProductImageDto[];

  @ApiProperty({ enum: ProductStatus })
  status: ProductStatus;
}

export class ProductDetailDto extends ProductListItemDto {
  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}

export class AdminProductDto extends ProductDetailDto {
  @ApiProperty()
  is_active: boolean;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Storefront position (1 = first); null = not pinned',
  })
  display_order: number | null;

  @ApiPropertyOptional({ example: 1 })
  category_id: number;
}

export class ImportErrorDto {
  @ApiProperty({ description: 'CSV line number (header is line 1)', example: 3 })
  row: number;

  @ApiProperty({ example: 'price must be a non-negative number' })
  message: string;
}

export class ImportSummaryDto {
  @ApiProperty({ example: 10 })
  total: number;

  @ApiProperty({ example: 8 })
  success: number;

  @ApiProperty({ example: 2 })
  failed: number;

  @ApiProperty({ example: 5 })
  created: number;

  @ApiProperty({ example: 3 })
  updated: number;

  @ApiProperty({ type: [ImportErrorDto] })
  errors: ImportErrorDto[];
}
