import { Body, Controller, Get, HttpStatus, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiErrors, ApiOkWrapped } from '../common/swagger/api-responses';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { PublicUser, UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiOkWrapped(UserResponseDto)
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.usersService.getProfile(user.id);
  }

  @Put('me')
  @ApiOperation({ summary: 'Update the current user profile' })
  @ApiOkWrapped(UserResponseDto)
  @ApiErrors(HttpStatus.BAD_REQUEST)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.usersService.updateProfile(user.id, dto);
  }
}
