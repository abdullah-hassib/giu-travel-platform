import { ConfigService } from '@nestjs/config';
import { FxRatesClient, validateRates } from './fx-rates.client';

const rates = {
  USD: 1,
  EGP: 50,
  AED: 3.67,
  GBP: 0.5,
  EUR: 0.8,
  JPY: 150,
  SAR: 3.75,
};
const body = () => ({
  success: true,
  base: 'USD',
  date: new Date().toISOString(),
  rates,
});

describe('FXRatesAPI client', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the public daily endpoint and retains only supported currency rates', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ...body(), rates: { ...rates, BTC: 99 } }),
        ),
      );
    const result = await new FxRatesClient(new ConfigService()).latest();
    expect(result).toEqual({
      rateDate: new Date().toISOString().slice(0, 10),
      rates,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://api.fxratesapi.com/latest?');
    expect(String(url)).toContain('resolution=1d');
    expect(String(url)).not.toContain('api_key');
    expect(options).toMatchObject({
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it('keeps an optional private key in the server-side request and sanitizes errors', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Provider failure with private-test-token'));
    const client = new FxRatesClient(
      new ConfigService({ FXRATES_API_KEY: 'private-test-token' }),
    );
    await expect(client.latest()).rejects.toThrow(
      'Exchange rates are unavailable',
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'api_key=private-test-token',
    );
  });

  it.each([401, 429, 500])('sanitizes HTTP %s failures', async (status) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('upstream private data', { status }));
    await expect(
      new FxRatesClient(new ConfigService()).latest(),
    ).rejects.toMatchObject({
      status: 503,
      message: 'Exchange rates are unavailable',
    });
  });

  it('sanitizes invalid JSON', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{invalid json'));
    await expect(
      new FxRatesClient(new ConfigService()).latest(),
    ).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    null,
    {},
    { ...body(), success: false },
    { ...body(), base: 'EUR' },
    { ...body(), date: '2026-02-30' },
    { ...body(), date: '9999-01-01' },
    { ...body(), rates: [] },
    { ...body(), rates: { ...rates, USD: 2 } },
    { ...body(), rates: { ...rates, EGP: undefined } },
    { ...body(), rates: { ...rates, EGP: '50' } },
    { ...body(), rates: { ...rates, EGP: 0 } },
    { ...body(), rates: { ...rates, EGP: -1 } },
    { ...body(), rates: { ...rates, EGP: Infinity } },
  ])('rejects invalid provider data (%j)', (input) => {
    expect(() => validateRates(input)).toThrow();
  });
});
