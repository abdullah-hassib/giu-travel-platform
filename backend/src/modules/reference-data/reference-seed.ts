import { Connection } from 'mongoose';
import { REFERENCE_SOURCE_ID } from './official-reference';
import {
  loadOfficialReferenceDataset,
  ReferenceDataset,
  referenceChecksum,
  REVIEWED_REFERENCE_CHECKSUM,
  validateReferenceDataset,
} from './reference-dataset';
import { referenceModels } from './reference.schema';

export async function seedOfficialReferences(
  connection: Connection,
  data: ReferenceDataset = loadOfficialReferenceDataset(),
) {
  validateReferenceDataset(data);
  if (referenceChecksum(data) !== REVIEWED_REFERENCE_CHECKSUM)
    throw new Error(
      'Only the reviewed official reference dataset may be seeded',
    );
  const models = referenceModels(connection);
  await Promise.all(Object.values(models).map((model) => model.init()));
  const counts = {
    countries: data.countries.length,
    cities: data.cities.length,
    airports: data.airports.length,
    attractions: data.attractions.length,
    currencies: data.currencies.length,
  };
  await connection.transaction(async (session) => {
    // Serialize concurrent seeders and make readiness visible only on full commit.
    await models.state.updateOne(
      { _id: REFERENCE_SOURCE_ID },
      {
        $set: {
          checksum: REVIEWED_REFERENCE_CHECKSUM,
          seededAt: new Date(),
          counts,
        },
      },
      { upsert: true, session },
    );
    await models.countries.bulkWrite(
      data.countries.map((row) => ({
        updateOne: {
          filter: { _id: row.code },
          update: { $set: { ...row } },
          upsert: true,
        },
      })),
      { session },
    );
    await models.cities.bulkWrite(
      data.cities.map((row) => ({
        updateOne: {
          filter: { _id: row.city_id },
          update: { $set: { ...row } },
          upsert: true,
        },
      })),
      { session },
    );
    await models.airports.bulkWrite(
      data.airports.map((row) => ({
        updateOne: {
          filter: { _id: row.iata_code },
          update: { $set: { ...row } },
          upsert: true,
        },
      })),
      { session },
    );
    await models.attractions.bulkWrite(
      data.attractions.map((row) => ({
        updateOne: {
          filter: { _id: row.attraction_id },
          update: { $set: { ...row } },
          upsert: true,
        },
      })),
      { session },
    );
    await models.currencies.bulkWrite(
      data.currencies.map((code) => ({
        updateOne: {
          filter: { _id: code },
          update: { $set: { code } },
          upsert: true,
        },
      })),
      { session },
    );
  });
  return counts;
}
