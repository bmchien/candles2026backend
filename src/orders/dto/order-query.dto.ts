import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { OrderStatus, ShippingMethod } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  endOfBusinessDay,
  isValidDateOnly,
  startOfBusinessDay,
} from '../../common/utils/business-date';

/** YYYY-MM-DD -> Vietnam day bound; other strings -> Date (invalid ones fail @IsDate). */
function toFilterDate(value: unknown, dayBound: (date: string) => Date): unknown {
  if (typeof value !== 'string') return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return isValidDateOnly(value) ? dayBound(value) : new Date(NaN);
  }
  return new Date(value);
}

export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;
}

export class AdminOrderQueryDto extends OrderQueryDto {
  /** Exact order id */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  id?: number;

  /** Matches customer name, phone, or account email/name (case-insensitive, partial) */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(100)
  @IsOptional()
  customer?: string;

  /** Created at or after (ISO-8601). A plain date (YYYY-MM-DD) is that day in Vietnam (UTC+7). */
  @Transform(({ value }) => toFilterDate(value, startOfBusinessDay))
  @IsDate()
  @IsOptional()
  from?: Date;

  /** Created at or before (ISO-8601). A plain date (YYYY-MM-DD) includes that whole day in Vietnam. */
  @Transform(({ value }) => toFilterDate(value, endOfBusinessDay))
  @IsDate()
  @IsOptional()
  to?: Date;

  @ApiPropertyOptional({ enum: ShippingMethod })
  @IsEnum(ShippingMethod)
  @IsOptional()
  shipping_method?: ShippingMethod;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status: OrderStatus;
}

/** Same filters as the admin list, without pagination (exports every matching order). */
export class AdminOrderExportQueryDto extends OmitType(AdminOrderQueryDto, ['page', 'limit']) {}
