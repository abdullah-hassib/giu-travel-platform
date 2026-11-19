import { isURL, ValidateBy, ValidationOptions } from 'class-validator';
import { IMAGE_ID_PATTERN } from '../../media-uploads/media.service';

export function isStoredLogoUrl(value: string): boolean {
  return (
    value.startsWith('/api/media/') &&
    IMAGE_ID_PATTERN.test(value.slice('/api/media/'.length))
  );
}

/** Preserve legacy absolute URLs and permit returning the current uploaded logo in a profile patch. */
export function IsAirlineLogoUrl(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAirlineLogoUrl',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          (isURL(value, { require_protocol: true }) || isStoredLogoUrl(value)),
        defaultMessage: () =>
          'logoUrl must be an absolute URL or the current uploaded media URL',
      },
    },
    options,
  );
}
