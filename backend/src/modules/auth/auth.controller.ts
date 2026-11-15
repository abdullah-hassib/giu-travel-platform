import { Body, Controller, Get, Header, HttpCode, HttpStatus, Patch, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CookieOptions, Request, Response } from 'express';
import { AuthService, LoginResult } from './auth.service';
import { AuthResponseDto, AuthUserDto, ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { AllowPasswordChange, AuthenticatedRequest, SessionGuard } from './security/session.guard';
import { clearAuthenticationCookies, readRefreshCookie, readSessionCookie, REFRESH_COOKIE_NAME, SESSION_COOKIE_NAME } from './security/session-cookie';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  private cookieOptions(request: Request): CookieOptions {
    return {
      httpOnly: true,
      secure: request.secure || this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/api',
    };
  }

  private setCookies(result: LoginResult, request: Request, response: Response): void {
    const options = this.cookieOptions(request);
    response.cookie(SESSION_COOKIE_NAME, result.token, { ...options, maxAge: Math.max(0, result.accessExpiresAt.getTime() - Date.now()) });
    response.cookie(REFRESH_COOKIE_NAME, result.refreshToken, { ...options, maxAge: Math.max(0, result.expiresAt.getTime() - Date.now()) });
    response.setHeader('Cache-Control', 'no-store');
  }

  @Post('register')
  @ApiCreatedResponse({ type: AuthUserDto })
  @ApiOperation({ summary: 'Register a traveler; no administrator self-registration' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @ApiOkResponse({ type: AuthResponseDto })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACC-04/ACC-19: issue HttpOnly access and refresh cookies' })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto);
    this.setCookies(result, request, response);
    return { user: result.user };
  }

  @Post('refresh')
  @ApiOkResponse({ type: AuthResponseDto })
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE_NAME)
  @ApiOperation({ summary: 'ACC-06/ACC-19: rotate both cookies; serialize refresh requests across tabs' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired, revoked or reused refresh credential. Sign in again.' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.auth.refresh(readRefreshCookie(request));
      this.setCookies(result, request, response);
      return { user: result.user };
    } catch (error) {
      if (error instanceof UnauthorizedException) clearAuthenticationCookies(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Invalidate current session, if present, and clear cookie' })
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(readSessionCookie(request), readRefreshCookie(request));
    clearAuthenticationCookies(response);
  }

  @Get('me')
  @AllowPasswordChange()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AuthUserDto })
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Get authenticated identity and roles' })
  me(@Req() request: AuthenticatedRequest) {
    return request.authUser;
  }

  @Patch('change-password')
  @AllowPasswordChange()
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
    clearAuthenticationCookies(response);
  }
}
