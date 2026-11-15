import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { SessionGuard } from './session.guard';
import { newSessionToken } from './session-cookie';

function ctx(cookie?: string): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ headers: { cookie } }) }) } as unknown as ExecutionContext;
}

describe('SessionGuard', () => {
  it('rejects missing cookies without calling MongoDB', async () => {
    const authenticate = jest.fn();
    const guard = new SessionGuard({ authenticate } as unknown as AuthService);
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it('attaches the resolved user to authenticated requests', async () => {
    const token = newSessionToken();
    const authenticate = jest.fn().mockResolvedValue({ id: 'user-id', roles: ['traveler'] });
    const request = { headers: { cookie: `giu_session=${token}` } } as Record<string, unknown>;
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    const guard = new SessionGuard({ authenticate } as unknown as AuthService);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith(token);
    expect(request.authUser).toEqual({ id: 'user-id', roles: ['traveler'] });
  });
});
