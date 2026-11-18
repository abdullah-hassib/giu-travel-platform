import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { RefundsService } from '../refunds/refunds.service';

@Injectable()
export class PaymentReconciliationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PaymentReconciliationWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private current?: Promise<void>;
  private retryAfter = 0;

  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      if (this.current || Date.now() < this.retryAfter) return;
      this.current = this.runOnce().finally(() => {
        this.current = undefined;
      });
    }, 1000);
    this.timer.unref();
  }

  async runOnce(): Promise<void> {
    try {
      const results = await Promise.allSettled([
        this.payments.runDue(),
        this.refunds.runDue(),
      ]);
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('Reconciliation batch failed');
    } catch {
      this.retryAfter = Date.now() + 60000;
      this.logger.warn(
        'Payment/refund reconciliation will retry after a temporary failure',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.current;
  }
}
