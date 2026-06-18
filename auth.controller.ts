// src/auth/auth.controller.ts
import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto, EnableMFADto, VerifyMFADto } from './dto';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with Google' })
  async googleAuth(@Body('token') token: string) {
    // Verify Google token and login
    return this.authService.googleLogin(token);
  }

  @Post('github')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with GitHub' })
  async githubAuth(@Body('code') code: string) {
    // Exchange code for token and login
    return this.authService.githubLogin(code);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refreshTokens(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshTokens(refreshToken);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user' })
  async logout(@Req() req) {
    return this.authService.logout(req.user.id);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('enable-mfa')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  async enableMFA(@Req() req) {
    return this.authService.enableMFA(req.user.id);
  }

  @Post('verify-mfa')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  async verifyMFA(@Req() req, @Body() dto: VerifyMFADto) {
    return this.authService.verifyMFA(req.user.id, dto);
  }
}