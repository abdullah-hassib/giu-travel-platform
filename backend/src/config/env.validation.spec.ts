import { environmentSchema } from './env.validation';
describe('environment validation', () => {
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
