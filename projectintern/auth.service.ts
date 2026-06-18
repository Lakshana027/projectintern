// src/auth/auth.service.ts
import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto, EnableMFADto, VerifyMFADto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        fullName: dto.fullName,
        phone: dto.phone,
        avatar: dto.avatar,
      },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await this.prisma.auditLog.create({
      data: {
        action: 'USER_REGISTER',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        changes: { email: user.email, fullName: user.fullName },
      },
    });

    return { user: this.excludePassword(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), refreshToken: tokens.refreshToken },
    });

    await this.prisma.auditLog.create({
      data: {
        action: 'USER_LOGIN',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
      },
    });

    return { user: this.excludePassword(user), ...tokens };
  }

  async googleLogin(googleUser: any) {
    let user = await this.prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: googleUser.email,
          fullName: googleUser.name,
          googleId: googleUser.googleId,
          avatar: googleUser.picture,
          isVerified: true,
        },
      });
    } else if (!user.googleId) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId: googleUser.googleId },
      });
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    return { user: this.excludePassword(user), ...tokens };
  }

  async githubLogin(githubUser: any) {
    let user = await this.prisma.user.findUnique({
      where: { email: githubUser.email },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: githubUser.email,
          fullName: githubUser.name,
          githubId: githubUser.githubId,
          avatar: githubUser.avatar_url,
          isVerified: true,
        },
      });
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    return { user: this.excludePassword(user), ...tokens };
  }

  async refreshTokens(refreshToken: string) {
    const user = await this.prisma.user.findFirst({
      where: { refreshToken },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return tokens;
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (user) {
      const resetToken = uuidv4();
      // Send email with reset token
      // await this.emailService.sendPasswordReset(user.email, resetToken);
    }

    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    // Validate reset token and update password
    return { message: 'Password reset successfully' };
  }

  async enableMFA(userId: string) {
    const secret = this.generateMFASecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret, mfaEnabled: true },
    });
    return { secret };
  }

  async verifyMFA(userId: string, dto: VerifyMFADto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // Verify TOTP token
    const isValid = this.verifyTOTP(dto.token, user.mfaSecret);
    if (!isValid) {
      throw new BadRequestException('Invalid MFA token');
    }
    const tokens = await this.generateTokens(user.id, user.email, user.role);
    return tokens;
  }

  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, { expiresIn: '7d', secret: process.env.JWT_REFRESH_SECRET }),
    ]);

    return { accessToken, refreshToken };
  }

  private excludePassword(user: any) {
    const { password, refreshToken, mfaSecret, ...userWithoutSensitive } = user;
    return userWithoutSensitive;
  }

  private generateMFASecret(): string {
    return uuidv4();
  }

  private verifyTOTP(token: string, secret: string): boolean {
    // Implement TOTP verification
    return true;
  }
}