import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HttpCache } from '../common/interceptors/cache-control.interceptor';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ApiErrors, ApiOkWrapped } from '../common/swagger/api-responses';
import {
  AdminScentResponseDto,
  CreateScentDto,
  ScentQueryDto,
  ScentResponseDto,
  UpdateScentDto,
} from './dto/scent.dto';
import { ScentsService } from './scents.service';

@ApiTags('Scents')
@Controller()
export class ScentsController {
  constructor(private readonly scentsService: ScentsService) {}

  @Public()
  @Get('scents')
  @HttpCache(60)
  @ApiOperation({ summary: 'Scent showcase: visible scents (display only)' })
  @ApiOkWrapped(ScentResponseDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@Query() query: ScentQueryDto) {
    return this.scentsService.listPublic(query.type);
  }

  @Get('admin/scents')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] All scents, including hidden ones' })
  @ApiOkWrapped(AdminScentResponseDto, { isArray: true })
  @ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
  listAdmin(@Query() query: ScentQueryDto) {
    return this.scentsService.listAdmin(query.type);
  }

  @Post('admin/scents')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Create a scent' })
  @ApiOkWrapped(AdminScentResponseDto, { status: HttpStatus.CREATED })
  @ApiErrors(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.CONFLICT,
  )
  create(@Body() dto: CreateScentDto) {
    return this.scentsService.create(dto);
  }

  @Put('admin/scents/:id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Update a scent (partial), e.g. hide/show with isActive' })
  @ApiOkWrapped(AdminScentResponseDto)
  @ApiErrors(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  update(@Param('id', ParseIdPipe) id: bigint, @Body() dto: UpdateScentDto) {
    return this.scentsService.update(id, dto);
  }

  @Delete('admin/scents/:id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Delete a scent (and its uploaded image)' })
  @ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  remove(@Param('id', ParseIdPipe) id: bigint) {
    return this.scentsService.remove(id);
  }
}
