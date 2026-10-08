import { ApiProperty } from '@nestjs/swagger';

export class ProvinceDto {
  @ApiProperty({ example: '1' })
  code: string;

  @ApiProperty({ example: 'Thành phố Hà Nội' })
  name: string;
}

export class WardDto {
  @ApiProperty({ example: '4' })
  code: string;

  @ApiProperty({ example: 'Phường Ba Đình' })
  name: string;

  @ApiProperty({ example: '1' })
  province_code: string;
}
