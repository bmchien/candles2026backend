import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { DiscountType, ProductStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ProductImageInputDto {
  /** Absolute http(s) URL of an image hosted elsewhere (no uploads to this server) */
  @IsString()
  @MaxLength(1000)
  @Matches(/^https?:\/\/\S+$/, { message: 'url must be an http(s) URL' })
  url: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  @IsOptional()
  position?: number;
}

export class CreateProductDto {
  /** Unique SKU */
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,64}$/, {
    message: 'code may contain only letters, digits, ".", "_" and "-" (max 64)',
  })
  code: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  shortDescription?: string;

  @IsString()
  @MaxLength(50_000)
  @IsOptional()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId: number;

  /** Base price (VND), max 2 decimals */
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(9_999_999_999.99)
  price: number;

  @ApiPropertyOptional({ enum: DiscountType, default: DiscountType.NONE })
  @IsEnum(DiscountType)
  @IsOptional()
  discountType?: DiscountType;

  /** PERCENT: 0–100; FIXED: 0–price */
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @IsOptional()
  discountValue?: number;

  /** ISO-8601; null = no lower bound */
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  discountStart?: Date | null;

  /** ISO-8601; null = no upper bound */
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  discountEnd?: Date | null;

  @ApiPropertyOptional({ enum: ProductStatus, default: ProductStatus.IN_STOCK })
  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  /** false = hidden from the storefront */
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** Storefront position chosen by the admin (1 = first); null = not pinned (newest first after the pinned ones) */
  @ApiPropertyOptional({ minimum: 1, maximum: 9999, nullable: true, type: Number })
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(9999)
  @IsOptional()
  displayOrder?: number | null;

  /** Replaces the product's tags */
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @IsOptional()
  tagIds?: number[];

  /** Replaces the product's images (ordered by position, then array order) */
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  @IsOptional()
  images?: ProductImageInputDto[];
}

/** PUT accepts any subset of the create fields; omitted fields stay unchanged. */
export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class UpdateProductStatusDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  status: ProductStatus;
}

export class UpdateProductVisibilityDto {
  @IsBoolean()
  isActive: boolean;
}
