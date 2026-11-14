import { hashPassword, verifyPassword } from './password';

describe('Password hashing', () => {
  it('salts every password and rejects incorrect passwords', async () => {
    const hashA = await hashPassword('test-password-123');
    const hashB = await hashPassword('test-password-123');
    expect(hashA).not.toBe(hashB);
    expect(await verifyPassword('test-password-123', hashA)).toBe(true);
    expect(await verifyPassword('incorrect', hashA)).toBe(false);
    expect(await verifyPassword('anything', 'malformed')).toBe(false);
  });
});
