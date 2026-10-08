import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ApiErrors, ApiOkWrapped, ApiPaginatedWrapped } from '../common/swagger/api-responses';
import {
  CreateProductDto,
  UpdateProductDto,
  UpdateProductStatusDto,
  UpdateProductVisibilityDto,
} from './dto/create-product.dto';
import { AdminProductQueryDto } from './dto/product-query.dto';
import { AdminProductDto, ImportSummaryDto } from './dto/product-response.dto';
import { MAX_IMPORT_FILE_SIZE, ProductsImportService } from './products-import.service';
import { ProductsService } from './products.service';

const IMAGE_UPLOAD_LIMIT_BYTES = Number(process.env.UPLOAD_MAX_SIZE_MB ?? 5) * 1024 * 1024;

@ApiTags('Admin - Products')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@ApiErrors(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN)
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly importService: ProductsImportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all products (including inactive)' })
  @ApiPaginatedWrapped(AdminProductDto)
  list(@Query() query: AdminProductQueryDto) {
    return this.productsService.listAdmin(query);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMPORT_FILE_SIZE, files: 1 },
    }),
  )
  @ApiOperation({
    summary: 'Import / upsert products from CSV (by code)',
    description:
      'Columns: code,name,short_description,description,category,price,discount_type,discount_value,discount_start,discount_end,status,is_active,tags. ' +
      'Required: code,name,category,price. category/tags match by slug or name; multiple tags separated by "|". ' +
      'Each row is saved in its own transaction; invalid rows are reported in `errors`.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkWrapped(ImportSummaryDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.PAYLOAD_TOO_LARGE)
  import(@UploadedFile() file: Express.Multer.File) {
    return this.importService.import(file);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by id (including inactive)' })
  @ApiOkWrapped(AdminProductDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  get(@Param('id', ParseIdPipe) id: bigint) {
    return this.productsService.getAdminById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a product' })
  @ApiOkWrapped(AdminProductDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a product (partial: omitted fields are unchanged)',
    description:
      'Price, discount, status, visibility, category, tags (replace) and images (replace).',
  })
  @ApiOkWrapped(AdminProductDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(@Param('id', ParseIdPipe) id: bigint, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Set stock status (IN_STOCK / OUT_OF_STOCK)' })
  @ApiOkWrapped(AdminProductDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setStatus(@Param('id', ParseIdPipe) id: bigint, @Body() dto: UpdateProductStatusDto) {
    return this.productsService.update(id, { status: dto.status });
  }

  @Patch(':id/visibility')
  @ApiOperation({ summary: 'Show / hide a product in the storefront' })
  @ApiOkWrapped(AdminProductDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  setVisibility(@Param('id', ParseIdPipe) id: bigint, @Body() dto: UpdateProductVisibilityDto) {
    return this.productsService.update(id, { isActive: dto.isActive });
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a product',
    description: 'Order history is preserved (order items keep name/code/price snapshots).',
  })
  @ApiErrors(HttpStatus.NOT_FOUND)
  remove(@Param('id', ParseIdPipe) id: bigint) {
    return this.productsService.remove(id);
  }

  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: IMAGE_UPLOAD_LIMIT_BYTES },
    }),
  )
  @ApiOperation({ summary: 'Upload product images (jpeg/png/webp/gif, appended at the end)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOkWrapped(AdminProductDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.PAYLOAD_TOO_LARGE)
  uploadImages(
    @Param('id', ParseIdPipe) id: bigint,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.productsService.addImages(id, files);
  }

  @Delete(':id/images/:imageId')
  @ApiOperation({ summary: 'Remove a product image' })
  @ApiOkWrapped(AdminProductDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  removeImage(
    @Param('id', ParseIdPipe) id: bigint,
    @Param('imageId', ParseIdPipe) imageId: bigint,
  ) {
    return this.productsService.removeImage(id, imageId);
  }
}
