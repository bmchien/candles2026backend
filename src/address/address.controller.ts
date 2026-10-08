import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { HttpCache } from '../common/interceptors/cache-control.interceptor';
import { ApiErrors, ApiOkWrapped } from '../common/swagger/api-responses';
import { AddressService } from './address.service';
import { ProvinceDto, WardDto } from './dto/address.dto';

@ApiTags('Address')
@Public()
@Controller('address')
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get('provinces')
  @HttpCache(3600)
  @ApiOperation({ summary: 'List Vietnamese provinces / centrally-run cities' })
  @ApiOkWrapped(ProvinceDto, { isArray: true })
  @ApiErrors(HttpStatus.BAD_GATEWAY)
  provinces() {
    return this.addressService.getProvinces();
  }

  @Get('provinces/:provinceCode/wards')
  @HttpCache(3600)
  @ApiOperation({ summary: 'List wards / communes of a province' })
  @ApiParam({ name: 'provinceCode', example: '1' })
  @ApiOkWrapped(WardDto, { isArray: true })
  @ApiErrors(HttpStatus.NOT_FOUND, HttpStatus.BAD_GATEWAY)
  wards(@Param('provinceCode') provinceCode: string) {
    return this.addressService.getWards(provinceCode);
  }
}
