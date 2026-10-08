import { Body, Controller, Get, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ApiErrors, ApiOkWrapped, ApiPaginatedWrapped } from '../common/swagger/api-responses';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({
    summary: 'Checkout: create an order from my cart',
    description:
      'Runs in one DB transaction: re-validates product visibility/stock, recalculates prices on the server, ' +
      'stores the purchase-time price on each item and clears the cart. PICKUP needs no address; DELIVERY needs a full address.',
  })
  @ApiOkWrapped(OrderResponseDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My order history (newest first)' })
  @ApiPaginatedWrapped(OrderResponseDto)
  list(@CurrentUser() user: AuthUser, @Query() query: OrderQueryDto) {
    return this.ordersService.listMine(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my orders' })
  @ApiOkWrapped(OrderResponseDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: bigint) {
    return this.ordersService.getMine(user.id, id);
  }
}
