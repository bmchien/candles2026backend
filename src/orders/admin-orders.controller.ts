import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ApiErrors, ApiOkWrapped, ApiPaginatedWrapped } from '../common/swagger/api-responses';
import { businessToday } from '../common/utils/business-date';
import {
  AdminOrderExportQueryDto,
  AdminOrderQueryDto,
  UpdateOrderStatusDto,
} from './dto/order-query.dto';
import { XLSX_MIME } from './orders-export';
import { AdminOrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

@ApiTags('Admin - Orders')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List orders (filter by status, date range, customer, order id)' })
  @ApiPaginatedWrapped(AdminOrderResponseDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@Query() query: AdminOrderQueryDto) {
    return this.ordersService.listAdmin(query);
  }

  // Declared before ':id' so that "export" is not parsed as an order id.
  @Get('export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Export orders to Excel (.xlsx)',
    description:
      'Same filters as the list (status, from/to order date — plain dates are Vietnam days — customer, id, shipping_method), ' +
      'no pagination. Sheet 1: one row per order; sheet 2: one row per product line. Max 10 000 orders (400 EXPORT_TOO_LARGE).',
  })
  @ApiProduces(XLSX_MIME)
  @ApiResponse({ status: 200, description: 'The .xlsx file' })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  async export(@Query() query: AdminOrderExportQueryDto): Promise<StreamableFile> {
    const buffer = await this.ordersService.exportAdmin(query);
    const range =
      query.from || query.to
        ? `${query.from ? businessToday(query.from) : 'dau'}_${query.to ? businessToday(query.to) : 'nay'}`
        : businessToday();
    const status = query.status ? `_${query.status.toLowerCase()}` : '';
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="don-hang_${range}${status}.xlsx"`,
      length: buffer.length,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Order detail' })
  @ApiOkWrapped(AdminOrderResponseDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@Param('id', ParseIdPipe) id: bigint) {
    return this.ordersService.getAdmin(id);
  }

  @Put(':id/status')
  @ApiOperation({
    summary: 'Change order status',
    description:
      'Admins may set any status at any time (skip ahead, go back to correct a mistake, cancel or reopen). ' +
      'Setting the current status again returns 400 INVALID_STATUS_TRANSITION. See `allowed_transitions`.',
  })
  @ApiOkWrapped(AdminOrderResponseDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  updateStatus(
    @Param('id', ParseIdPipe) id: bigint,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.ordersService.updateStatus(id, dto.status, admin.id);
  }
}
