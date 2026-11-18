import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  Header,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles, RolesGuard } from '../../modules/auth/security/roles.guard';
import {
  AuthenticatedRequest,
  SessionGuard,
} from '../../modules/auth/security/session.guard';
import { SESSION_COOKIE_NAME } from '../../modules/auth/security/session-cookie';
import { UserRole } from '../../modules/users/schemas/user.schema';
import { PublicUser } from '../../modules/users/users.service';

/** Requires an active session with one of the roles. Private responses are never cached. */
export const Authenticated = (...roles: UserRole[]) =>
  applyDecorators(
    UseGuards(SessionGuard, RolesGuard),
    Roles(...roles),
    Header('Cache-Control', 'no-store'),
    ApiCookieAuth(SESSION_COOKIE_NAME),
    ApiUnauthorizedResponse({ description: 'Log in first' }),
    ApiForbiddenResponse({
      description: `Requires role: ${roles.join(' or ')}`,
    }),
  );

/** The account behind the session, set by SessionGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authUser,
);
