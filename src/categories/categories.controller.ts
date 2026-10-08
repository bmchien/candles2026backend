import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HttpCache } from '../common/interceptors/cache-control.interceptor';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ApiErrors, ApiOkWrapped } from '../common/swagger/api-responses';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto, CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@ApiTags('Categories')
@Controller()
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get('categories')
  @HttpCache(60)
  @ApiOperation({ summary: 'List all categories' })
  @ApiOkWrapped(CategoryResponseDto, { isArray: true })
  findAll() {
    return this.categoriesService.findAll();
  }

  @Post('admin/categories')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Create a category' })
  @ApiOkWrapped(CategoryResponseDto, { status: HttpStatus.CREATED })
  @ApiErrors(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.CONFLICT,
  )
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Put('admin/categories/:id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Update a category' })
  @ApiOkWrapped(CategoryResponseDto)
  @ApiErrors(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  update(@Param('id', ParseIdPipe) id: bigint, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Delete('admin/categories/:id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Delete a category (409 if products still use it)' })
  @ApiErrors(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  remove(@Param('id', ParseIdPipe) id: bigint) {
    return this.categoriesService.remove(id);
  }
}
