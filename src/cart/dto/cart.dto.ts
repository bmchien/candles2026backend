import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_ITEM_QUANTITY = 99;

export class AddCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  /** Quantity to add (added to any quantity already in the cart) */
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: MAX_ITEM_QUANTITY })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  @IsOptional()
  quantity: number = 1;
}

export class UpdateCartItemDto {
  /** New absolute quantity. Use DELETE to remove an item. */
  @ApiProperty({ minimum: 1, maximum: MAX_ITEM_QUANTITY })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  quantity: number;
}

export class CartProductDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'IP15-128-BLK' })
  code: string;

  @ApiProperty({ example: 'iPhone 15 128GB Đen' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  image: string | null;

  @ApiProperty({ enum: ProductStatus })
  status: ProductStatus;
}

export class CartItemResponseDto {
  @ApiProperty({ example: 1 })
  product_id: number;

  @ApiProperty({ type: CartProductDto })
  product: CartProductDto;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ description: 'Base unit price', example: 22990000 })
  unit_price: number;

  @ApiProperty({ description: 'Discounted unit price (server time)', example: 20691000 })
  final_price: number;

  @ApiProperty({ description: 'final_price × quantity', example: 41382000 })
  subtotal: number;

  @ApiProperty({ description: 'false when the product is hidden or out of stock' })
  available: boolean;

  @ApiProperty({ enum: ['INACTIVE', 'OUT_OF_STOCK'], nullable: true, type: String })
  unavailable_reason: 'INACTIVE' | 'OUT_OF_STOCK' | null;
}

export class CartResponseDto {
  @ApiProperty({ example: 1, nullable: true, type: Number })
  id: number | null;

  @ApiProperty({ type: [CartItemResponseDto] })
  items: CartItemResponseDto[];

  @ApiProperty({ description: 'Sum of quantities of available items', example: 3 })
  total_quantity: number;

  @ApiProperty({ description: 'Sum of subtotals of available items', example: 41382000 })
  total: number;

  @ApiProperty({ description: 'true when checkout would be rejected because of unavailable items' })
  has_unavailable_items: boolean;

  @ApiPropertyOptional({
    description:
      'Only when POST /cart/items created a new guest cart: send it back as X-Cart-Token. Returned once.',
  })
  guest_token?: string;
}

export class MergeSummaryDto {
  @ApiProperty({ description: 'Guest cart lines moved into the user cart', example: 2 })
  merged: number;

  @ApiProperty({ description: 'Lines dropped because the product is hidden or out of stock' })
  skipped: number;
}

export class MergeCartResponseDto extends CartResponseDto {
  @ApiProperty({ type: MergeSummaryDto })
  merge: MergeSummaryDto;
}
