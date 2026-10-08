import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export enum ProductSort {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NAME_ASC = 'name_asc',
  NAME_DESC = 'name_desc',
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by name, SKU/code or tag name', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ description: 'Category slug or numeric id', example: 'dien-thoai' })
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({
    description: 'Tag slug; comma-separated for several (matches any)',
    example: 'ban-chay,giam-gia',
  })
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  tag?: string;

  @ApiPropertyOptional({ description: 'Minimum final (discounted) price', example: 100000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  min_price?: number;

  @ApiPropertyOptional({ description: 'Maximum final (discounted) price', example: 5000000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  max_price?: number;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  @ApiPropertyOptional({
    description: 'true = only products whose discount applies right now (final price < price)',
    type: Boolean,
  })
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  @IsOptional()
  on_sale?: boolean;

  @ApiPropertyOptional({ enum: ProductSort, default: ProductSort.NEWEST })
  @IsEnum(ProductSort)
  @IsOptional()
  sort: ProductSort = ProductSort.NEWEST;
}

export class AdminProductQueryDto extends ProductQueryDto {
  @ApiPropertyOptional({ description: 'Filter by visibility', type: Boolean })
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
