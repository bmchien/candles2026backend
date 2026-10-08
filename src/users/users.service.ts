import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

/** Public projection of a user — password_hash is never selected. */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: bigint): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  }

  /** Includes the password hash: for credential checks inside AuthService only. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: { name: string; email: string; passwordHash: string }): Promise<PublicUser> {
    return this.prisma.user.create({ data, select: publicUserSelect });
  }

  async getProfile(id: bigint): Promise<PublicUser> {
    const user = await this.findById(id);
    if (!user) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'User not found');
    return user;
  }

  updateProfile(id: bigint, data: { name: string }): Promise<PublicUser> {
    return this.prisma.user.update({ where: { id }, data, select: publicUserSelect });
  }
}
