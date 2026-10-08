import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ScentType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateScentDto {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @Transform(trim)
  @IsString()
  @Length(1, 5000)
  description: string;

  @ApiProperty({
    enum: ScentType,
    description: 'PERFUME = hương nước hoa, NATURAL = hương tự nhiên',
  })
  @IsEnum(ScentType)
  type: ScentType;

  /** http(s) URL or the /uploads/... URL returned by POST /admin/scents/image; null removes it */
  @ApiPropertyOptional({ nullable: true, type: String })
  @Transform(trim)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  @Matches(/^(https?:\/\/\S+|\/uploads\/\S+)$/, {
    message: 'imageUrl must be an http(s) URL or an /uploads/ path',
  })
  @IsOptional()
  imageUrl?: string | null;

  /** false = hidden from the showcase page */
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/** PUT accepts any subset of the create fields. */
export class UpdateScentDto extends PartialType(CreateScentDto) {}

export class ScentQueryDto {
  @ApiPropertyOptional({ enum: ScentType })
  @IsEnum(ScentType)
  @IsOptional()
  type?: ScentType;
}

export class ScentResponseDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'Hoa nhài' }) name: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: ScentType }) type: ScentType;
  @ApiProperty({ nullable: true, type: String }) image_url: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at: Date;
}

export class AdminScentResponseDto extends ScentResponseDto {
  @ApiProperty() is_active: boolean;
}

export class UploadedImageDto {
  @ApiProperty({ example: 'http://localhost:3001/uploads/scents/2f1c….webp' }) url: string;
}
