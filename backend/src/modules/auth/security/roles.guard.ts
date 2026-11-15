import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/schemas/user.schema';
import { AuthenticatedRequest } from './session.guard';

const REQUIRED_ROLES = 'roles';
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_ROLES, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().authUser;
    if (!user || !required.some((role) => user.roles.includes(role))) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
