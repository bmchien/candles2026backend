import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class UpdateProfileDto {
  /** Display name */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  name: string;
}
