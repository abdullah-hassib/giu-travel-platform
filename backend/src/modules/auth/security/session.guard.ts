import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PublicUser } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { readSessionCookie } from './session-cookie';

export interface AuthenticatedRequest extends Request {
  authUser: PublicUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionCookie(request);
    if (!token) throw new UnauthorizedException('Authentication required');
    request.authUser = await this.authService.authenticate(token);
    return true;
  }
}
