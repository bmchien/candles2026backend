import { ApiProperty } from '@nestjs/swagger';
import { AdminOrderResponseDto } from '../../orders/dto/order-response.dto';

class ProductStatsDto {
  @ApiProperty() total: number;
  @ApiProperty() active: number;
  @ApiProperty() inactive: number;
  @ApiProperty() in_stock: number;
  @ApiProperty() out_of_stock: number;
}

class OrderStatsDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Orders created since local midnight' }) today: number;

  @ApiProperty({
    description: 'Per status: { count, amount }',
    example: {
      AWAITING_DEPOSIT: { count: 3, amount: 1500000 },
      DELIVERED: { count: 10, amount: 25000000 },
    },
  })
  by_status: Record<string, { count: number; amount: number }>;
}

class RevenueStatsDto {
  @ApiProperty({ description: 'Sum of DELIVERED orders (Đã giao)' }) delivered_total: number;
  @ApiProperty({ description: 'Sum of DELIVERED orders placed in the last 30 days' })
  delivered_last_30_days: number;
}

class TopProductDto {
  @ApiProperty() product_code: string;
  @ApiProperty() product_name: string;
  @ApiProperty() quantity_sold: number;
  @ApiProperty() revenue: number;
}

export class DashboardDto {
  @ApiProperty({ type: ProductStatsDto }) products: ProductStatsDto;
  @ApiProperty({ type: OrderStatsDto }) orders: OrderStatsDto;
  @ApiProperty({ type: RevenueStatsDto }) revenue: RevenueStatsDto;
  @ApiProperty({ example: { total: 120 } }) customers: { total: number };
  @ApiProperty({ example: { categories: 4, tags: 8 } }) catalog: {
    categories: number;
    tags: number;
  };
  @ApiProperty({ type: [TopProductDto], description: 'Best sellers (excluding cancelled orders)' })
  top_products: TopProductDto[];
  @ApiProperty({ type: [AdminOrderResponseDto] }) recent_orders: AdminOrderResponseDto[];
  @ApiProperty({ type: String, format: 'date-time' }) generated_at: Date;
}
