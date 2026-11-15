import { environmentSchema } from './env.validation';
describe('environment validation', () => {
  it('enforces the workbook five-attempt, fifteen-minute lockout rule', () => {
    const base = { MONGODB_URI: 'mongodb://localhost/test' };
    expect(environmentSchema.validate({ ...base, AUTH_MAX_FAILED_ATTEMPTS: 6 }).error).toBeDefined();
    expect(environmentSchema.validate({ ...base, AUTH_LOCKOUT_MINUTES: 10 }).error).toBeDefined();
    const { error, value } = environmentSchema.validate(base);
    expect(error).toBeUndefined();
    expect(value.AUTH_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(value.AUTH_LOCKOUT_MINUTES).toBe(15);
  });
  it('requires MongoDB URI', () => {
    expect(environmentSchema.validate({}).error).toBeDefined();
  });
  it('accepts a mongodb+srv connection string', () => {
    const { error, value } = environmentSchema.validate({ MONGODB_URI: 'mongodb+srv://user:pass@example.mongodb.net/db' });
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3000);
  });
  it('rejects invalid ports and URI formats', () => {
    expect(environmentSchema.validate({ MONGODB_URI: 'https://bad', PORT: 0 }).error).toBeDefined();
  });
});
