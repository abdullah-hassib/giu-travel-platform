import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PublicUser } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { readSessionCookie } from './session-cookie';

export interface AuthenticatedRequest extends Request {
  authUser: PublicUser;
}

const ALLOW_PASSWORD_CHANGE = 'allowPasswordChange';
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService, private readonly reflector: Reflector = new Reflector()) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionCookie(request);
    if (!token) throw new UnauthorizedException('Authentication required');
    request.authUser = await this.authService.authenticate(token);
    if (request.authUser.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE, [context.getHandler(), context.getClass()],
    )) {
      throw new ForbiddenException('Password change required');
    }
    return true;
  }
}
