import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingMethod } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DATE_ONLY_PATTERN } from '../../common/utils/business-date';

/** How far ahead a customer may ask to receive an order. */
export const DESIRED_DATE_MAX_DAYS = 180;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ShippingAddressDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  provinceCode: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  provinceName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  wardCode: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  wardName: string;

  /** House number, street, ... */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  detail: string;
}

export class CreateOrderDto {
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  customerName: string;

  /** Vietnamese phone number: 0xxxxxxxxx or +84xxxxxxxxx */
  @ApiProperty({ example: '0912345678' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s.-]/g, '') : value))
  @IsString()
  @Matches(/^(0|\+84)\d{9,10}$/, { message: 'phone must be a valid Vietnamese phone number' })
  phone: string;

  @ApiProperty({ enum: ShippingMethod })
  @IsEnum(ShippingMethod)
  shippingMethod: ShippingMethod;

  /** Desired receive date (Vietnam calendar day), from today up to DESIRED_DATE_MAX_DAYS ahead */
  @ApiProperty({ example: '2026-10-20', format: 'date' })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: 'desiredDate must be a date in YYYY-MM-DD format' })
  desiredDate: string;

  @ApiPropertyOptional({
    type: ShippingAddressDto,
    nullable: true,
    description: 'Required (all fields) for DELIVERY; ignored for PICKUP',
  })
  // Validated only for DELIVERY; for PICKUP the address is ignored and stored as NULL.
  @ValidateIf((o: CreateOrderDto) => o.shippingMethod === ShippingMethod.DELIVERY)
  @IsObject({ message: 'address is required for DELIVERY' })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  address?: ShippingAddressDto | null;
}
