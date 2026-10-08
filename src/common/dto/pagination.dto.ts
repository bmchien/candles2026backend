import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_PAGE_LIMIT = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  @IsOptional()
  limit = 20;
}

export class PaginationMetaDto {
  @ApiPropertyOptional({ example: 1 })
  page: number;

  @ApiPropertyOptional({ example: 20 })
  limit: number;

  @ApiPropertyOptional({ example: 100 })
  total: number;

  @ApiPropertyOptional({ example: 5 })
  totalPages: number;
}

/**
 * Return this from a controller to get the paginated envelope:
 * `{ success: true, data: [...], pagination: {...} }`.
 */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly pagination: PaginationMetaDto,
  ) {}

  static of<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
    return new Paginated(items, {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    });
  }
}
