import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { HttpCache } from '../common/interceptors/cache-control.interceptor';
import { ApiErrors, ApiOkWrapped, ApiPaginatedWrapped } from '../common/swagger/api-responses';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductDetailDto, ProductListItemDto } from './dto/product-response.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@Public()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @HttpCache(30)
  @ApiOperation({
    summary: 'List / search / filter active products',
    description:
      'Inactive products are never returned. `min_price`/`max_price` and price sorting use the final (discounted) price.',
  })
  @ApiPaginatedWrapped(ProductListItemDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  list(@Query() query: ProductQueryDto) {
    return this.productsService.listPublic(query);
  }

  @Get(':code')
  @HttpCache(30)
  @ApiOperation({ summary: 'Product detail by SKU/code (404 when inactive)' })
  @ApiParam({ name: 'code', example: 'IP15-128-BLK' })
  @ApiOkWrapped(ProductDetailDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  detail(@Param('code') code: string) {
    return this.productsService.getPublicByCode(code);
  }
}
