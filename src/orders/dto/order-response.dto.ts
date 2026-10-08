import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus, ShippingMethod } from '@prisma/client';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class OrderItemResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'null if the product was deleted later',
  })
  product_id: number | null;

  @ApiProperty({ example: 'IP15-128-BLK' })
  product_code: string;

  @ApiProperty({ example: 'iPhone 15 128GB Đen' })
  product_name: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Current first image of the product (display only); null if deleted',
  })
  image: string | null;

  @ApiProperty({ description: 'Unit price paid (final price at purchase time)', example: 20691000 })
  price: number;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ example: 41382000 })
  subtotal: number;
}

export class OrderAddressDto {
  @ApiProperty() province_code: string;
  @ApiProperty() province_name: string;
  @ApiProperty() ward_code: string;
  @ApiProperty() ward_name: string;
  @ApiProperty() detail: string;
}

export class OrderResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ enum: ShippingMethod })
  shipping_method: ShippingMethod;

  @ApiProperty({ example: 'Nguyễn Văn An' })
  customer_name: string;

  @ApiProperty({ example: '0912345678' })
  customer_phone: string;

  @ApiProperty({ type: OrderAddressDto, nullable: true, description: 'null for PICKUP' })
  address: OrderAddressDto | null;

  @ApiProperty({
    example: '2026-10-20',
    nullable: true,
    type: String,
    format: 'date',
    description:
      'Desired receive date (Vietnam calendar day); null for orders placed before it existed',
  })
  desired_date: string | null;

  @ApiProperty({ example: 41382000 })
  total_amount: number;

  @ApiProperty({ example: 2 })
  item_count: number;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}

export class AdminOrderResponseDto extends OrderResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({
    enum: OrderStatus,
    isArray: true,
    description: 'Statuses this order may move to next',
  })
  allowed_transitions: OrderStatus[];
}
