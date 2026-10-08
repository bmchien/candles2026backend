import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
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
  UploadedImageDto,
} from './dto/scent.dto';
import { ScentsService } from './scents.service';

const IMAGE_UPLOAD_LIMIT_BYTES = Number(process.env.UPLOAD_MAX_SIZE_MB ?? 5) * 1024 * 1024;

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

  // Declared before the ':id' routes.
  @Post('admin/scents/image')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMAGE_UPLOAD_LIMIT_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary: '[Admin] Upload a scent image (jpeg/png/webp/gif) and get its URL',
    description: 'Use the returned `url` as `imageUrl` when creating / updating a scent.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkWrapped(UploadedImageDto, { status: HttpStatus.CREATED })
  @ApiErrors(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.PAYLOAD_TOO_LARGE,
  )
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    return this.scentsService.uploadImage(file);
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
