import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientSession } from 'mongoose';

export const PROVIDER_KINDS = ['airline', 'hotel'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export const ADMINISTRATION_PROVIDER_ADAPTERS = Symbol(
  'ADMINISTRATION_PROVIDER_ADAPTERS',
);

/** Hassib-approved boundary. Implementations belong to Adham/MK. */
export interface ProviderAdministrationAdapter {
  readonly kind: ProviderKind;
  /** Owner lookup plus conditional write/fence using this session. Missing -> 404. */
  lockExisting(
    providerId: string,
    session: ClientSession,
  ): Promise<{ id: string; kind: ProviderKind }>;
}

@Injectable()
export class AdministrationProviderAdapters {
  constructor(
    @Inject(ADMINISTRATION_PROVIDER_ADAPTERS)
    private readonly adapters: ProviderAdministrationAdapter[],
  ) {
    if (
      new Set(adapters.map((adapter) => adapter.kind)).size !== adapters.length
    )
      throw new Error(
        'Only one administration adapter per provider kind may be registered',
      );
  }
  forKind(kind: ProviderKind): ProviderAdministrationAdapter {
    if (!PROVIDER_KINDS.includes(kind))
      throw new NotFoundException('Provider type not found');
    const adapter = this.adapters.find((entry) => entry.kind === kind);
    if (!adapter)
      throw new ServiceUnavailableException(
        'Provider administration integration is not configured',
      );
    return adapter;
  }
}
