import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { SLUG_PATTERN } from '../../common/utils/slug';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Shared by categories and tags. */
export class NameSlugDto {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  /** Lower-case, digits and dashes. Generated from `name` when omitted. */
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(SLUG_PATTERN, { message: 'slug must contain lowercase letters, digits and dashes only' })
  @IsOptional()
  slug?: string;
}

export class CreateCategoryDto extends NameSlugDto {}
export class UpdateCategoryDto extends PartialType(NameSlugDto) {}

export class CategoryResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Điện thoại' })
  name: string;

  @ApiProperty({ example: 'dien-thoai' })
  slug: string;

  @ApiProperty({ description: 'Number of active products', example: 12 })
  product_count: number;
}
