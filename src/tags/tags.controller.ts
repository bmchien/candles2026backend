import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HttpCache } from '../common/interceptors/cache-control.interceptor';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ApiErrors, ApiOkWrapped } from '../common/swagger/api-responses';
import { CreateTagDto, TagResponseDto, UpdateTagDto } from './dto/tag.dto';
import { TagsService } from './tags.service';

@ApiTags('Tags')
@Controller()
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Public()
  @Get('tags')
  @HttpCache(60)
  @ApiOperation({ summary: 'List all tags' })
  @ApiOkWrapped(TagResponseDto, { isArray: true })
  findAll() {
    return this.tagsService.findAll();
  }

  @Post('admin/tags')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Create a tag' })
  @ApiOkWrapped(TagResponseDto, { status: HttpStatus.CREATED })
  @ApiErrors(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.CONFLICT,
  )
  create(@Body() dto: CreateTagDto) {
    return this.tagsService.create(dto);
  }

  @Put('admin/tags/:id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Update a tag' })
  @ApiOkWrapped(TagResponseDto)
  @ApiErrors(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  update(@Param('id', ParseIdPipe) id: bigint, @Body() dto: UpdateTagDto) {
    return this.tagsService.update(id, dto);
  }

  @Delete('admin/tags/:id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Delete a tag (removes it from all products)' })
  @ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND)
  remove(@Param('id', ParseIdPipe) id: bigint) {
    return this.tagsService.remove(id);
  }
}
