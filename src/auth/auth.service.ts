import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PublicUser, UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { hashPassword, verifyPassword } from './password';
import { JwtPayload } from './strategies/jwt.strategy';

export interface AuthResult {
  access_token: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: Promise<string>;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersService.findByEmailWithPassword(dto.email);
    if (existing) {
      throw AppException.conflict(ErrorCode.EMAIL_ALREADY_EXISTS, 'Email is already registered');
    }
    const passwordHash = await hashPassword(dto.password);
    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
    });
    this.logger.log({ userId: user.id.toString() }, 'User registered');
    return this.issueToken(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    // Always run a hash verification so response time does not reveal whether the email exists.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await verifyPassword(hash, dto.password);

    if (!user || !valid) {
      this.logger.warn({ email: dto.email }, 'Login failed: invalid credentials');
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password',
      );
    }

    this.logger.log({ userId: user.id.toString(), role: user.role }, 'User logged in');
    return this.issueToken({ id: user.id, name: user.name, email: user.email, role: user.role });
  }

  private async issueToken(user: PublicUser): Promise<AuthResult> {
    const payload: JwtPayload = { sub: user.id.toString(), role: user.role };
    const access_token = await this.jwtService.signAsync(payload);
    return { access_token, user };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('dummy-password-for-timing-safety');
    return this.dummyHash;
  }
}
