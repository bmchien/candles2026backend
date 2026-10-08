import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  /**
   * Re-reads the user so deleted accounts and role changes take effect
   * immediately instead of when the token expires.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub || !/^\d+$/.test(payload.sub)) throw new UnauthorizedException();
    const user = await this.usersService.findById(BigInt(payload.sub));
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
