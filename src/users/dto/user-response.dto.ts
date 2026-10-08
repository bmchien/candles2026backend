import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Nguyễn Văn An' })
  name: string;

  @ApiProperty({ example: 'an.nguyen@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.CUSTOMER })
  role: Role;
}
