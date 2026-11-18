import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { RefundsService } from '../refunds/refunds.service';
import { PaymentReconciliationWorker } from './payment-reconciliation.worker';

// HTTP suites disable automatic jobs. These cases cover the production scheduler
// behavior that explicit runDue calls in those suites cannot exercise.
describe('Payment reconciliation lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function worker(environment = 'development') {
    const payments = { runDue: jest.fn().mockResolvedValue(undefined) };
    const refunds = { runDue: jest.fn().mockResolvedValue(undefined) };
    const instance = new PaymentReconciliationWorker(
      payments as unknown as PaymentsService,
      refunds as unknown as RefundsService,
      { get: () => environment } as unknown as ConfigService,
    );
    return { instance, payments, refunds };
  }

  it('reconciles on the production loop and stops scheduling after shutdown', async () => {
    const { instance, payments, refunds } = worker();
    instance.onModuleInit();
    await jest.advanceTimersByTimeAsync(3000);
    expect(payments.runDue).toHaveBeenCalledTimes(3);
    expect(refunds.runDue).toHaveBeenCalledTimes(3);
    await instance.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(3000);
    expect(payments.runDue).toHaveBeenCalledTimes(3);
  });

  it('prevents overlapping batches and waits for in-flight work before shutdown', async () => {
    const { instance, payments } = worker();
    let release!: () => void;
    payments.runDue.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    instance.onModuleInit();
    await jest.advanceTimersByTimeAsync(5000);
    expect(payments.runDue).toHaveBeenCalledTimes(1);
    const stopped = instance.onModuleDestroy();
    release();
    await stopped;
    await jest.advanceTimersByTimeAsync(5000);
    expect(payments.runDue).toHaveBeenCalledTimes(1);
  });

  it('backs off a failed batch and logs a fixed safe message', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { instance, payments } = worker();
    payments.runDue.mockRejectedValueOnce(
      new Error('synthetic-sensitive-fixture'),
    );
    instance.onModuleInit();
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(59000);
    expect(payments.runDue).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(payments.runDue).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      'Payment/refund reconciliation will retry after a temporary failure',
    );
    await instance.onModuleDestroy();
  });

  it('waits for the other batch after one fails instead of overlapping reconciliation', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { instance, payments, refunds } = worker();
    payments.runDue.mockRejectedValueOnce(new Error('Controlled failure'));
    let release!: () => void;
    refunds.runDue.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    instance.onModuleInit();
    await jest.advanceTimersByTimeAsync(5000);
    expect(payments.runDue).toHaveBeenCalledTimes(1);
    expect(refunds.runDue).toHaveBeenCalledTimes(1);
    release();
    await instance.onModuleDestroy();
  });

  it('leaves background scheduling off in isolated test environments', async () => {
    const { instance, payments } = worker('test');
    instance.onModuleInit();
    await jest.advanceTimersByTimeAsync(10000);
    expect(payments.runDue).not.toHaveBeenCalled();
    await instance.onModuleDestroy();
  });
});
