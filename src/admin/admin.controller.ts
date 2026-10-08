import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiErrors, ApiOkWrapped } from '../common/swagger/api-responses';
import { AdminService } from './admin.service';
import { DashboardDto } from './dto/dashboard.dto';

@ApiTags('Admin - Dashboard')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard statistics' })
  @ApiOkWrapped(DashboardDto)
  dashboard() {
    return this.adminService.getDashboard();
  }
}
