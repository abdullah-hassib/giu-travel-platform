import { Model, Types } from 'mongoose';
import { User } from '../modules/users/schemas/user.schema';

/** MongoDB's unique-index violation, used as the final arbiter of "only once" rules. */
export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

/** Treat user input as literal text inside a regular expression. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ACC-12: content written by a deactivated (or removed) account shows this name. */
export const DELETED_USER = 'Deleted user';

export async function displayNames(
  users: Model<User>,
  ids: Types.ObjectId[],
): Promise<Map<string, string>> {
  const rows = await users
    .find({ _id: { $in: ids } }, { fullName: 1, status: 1 })
    .lean();
  return new Map(
    rows.map((user) => [
      user._id.toString(),
      user.status === 'deactivated' ? DELETED_USER : user.fullName,
    ]),
  );
}
