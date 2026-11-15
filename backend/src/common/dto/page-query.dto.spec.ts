import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PageQueryDto } from './page-query.dto';
describe('PageQueryDto', () => {
  it('converts valid page and limit query values', async () => {
    const dto = plainToInstance(PageQueryDto, { page: '2', limit: '50' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
  });
  it('rejects unsupported sortBy characters and excess page size', async () => {
    const dto = plainToInstance(PageQueryDto, { limit: '200', sortBy: '$where' });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
