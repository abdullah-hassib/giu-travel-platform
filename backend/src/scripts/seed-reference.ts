import 'reflect-metadata';
import { createConnection } from 'mongoose';
import {
  loadOfficialReferenceDataset,
  REVIEWED_REFERENCE_CHECKSUM,
} from '../modules/reference-data/reference-dataset';
import { seedOfficialReferences } from '../modules/reference-data/reference-seed';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply') || args.length > 1)
    throw new Error('Usage: seed:reference [--apply]');
  const data = loadOfficialReferenceDataset();
  if (!args.includes('--apply')) {
    process.stdout.write(
      JSON.stringify({
        mode: 'validate-only',
        checksum: REVIEWED_REFERENCE_CHECKSUM,
        countries: data.countries.length,
        cities: data.cities.length,
        airports: data.airports.length,
        attractions: data.attractions.length,
        currencies: data.currencies.length,
      }) + '\n',
    );
    return;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri))
    throw new Error('MONGODB_URI must be configured privately for --apply');
  const connection = createConnection(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 5,
  });
  try {
    await connection.asPromise();
    const counts = await seedOfficialReferences(connection, data);
    process.stdout.write(JSON.stringify({ mode: 'applied', counts }) + '\n');
  } finally {
    await connection.close();
  }
}
if (require.main === module) {
  void main().catch(() => {
    // Driver diagnostics can contain credentials/hostnames; never echo them.
    process.stderr.write(
      'Reference seed failed. Check official CSV integrity, private configuration and replica-set availability.\n',
    );
    process.exitCode = 1;
  });
}
