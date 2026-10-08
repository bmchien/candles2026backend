import { ApiProperty, PartialType } from '@nestjs/swagger';
import { NameSlugDto } from '../../categories/dto/category.dto';

export class CreateTagDto extends NameSlugDto {}
export class UpdateTagDto extends PartialType(NameSlugDto) {}

export class TagResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Bán chạy' })
  name: string;

  @ApiProperty({ example: 'ban-chay' })
  slug: string;

  @ApiProperty({ description: 'Number of active products', example: 5 })
  product_count: number;
}
