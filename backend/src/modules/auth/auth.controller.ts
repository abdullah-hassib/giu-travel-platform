import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CookieOptions, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { AuthenticatedRequest, SessionGuard } from './security/session.guard';
import { readSessionCookie, SESSION_COOKIE_NAME } from './security/session-cookie';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/api',
      maxAge: this.auth.sessionTtlMilliseconds,
    };
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a traveler; no administrator self-registration' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with a server-side session; token stored in HttpOnly cookie' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const { token, user } = await this.auth.login(dto);
    response.cookie(SESSION_COOKIE_NAME, token, this.cookieOptions());
    return { user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Invalidate current session, if present, and clear cookie' })
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(readSessionCookie(request));
    response.clearCookie(SESSION_COOKIE_NAME, { ...this.cookieOptions(), maxAge: undefined });
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Get authenticated identity and roles' })
  me(@Req() request: AuthenticatedRequest) {
    return request.authUser;
  }

  @Patch('change-password')
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change password and revoke all active sessions' })
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword(request.authUser.id, dto.currentPassword, dto.newPassword);
    response.clearCookie(SESSION_COOKIE_NAME, { ...this.cookieOptions(), maxAge: undefined });
  }
}
