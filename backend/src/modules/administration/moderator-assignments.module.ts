import { Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ModeratorAssignment,
  ModeratorAssignmentSchema,
} from './schemas/moderator-assignment.schema';

/** No provider/Auth imports: owners can consume assignments without module cycles. */
@Injectable()
export class ModeratorAssignmentsService {
  constructor(
    @InjectModel(ModeratorAssignment.name)
    private readonly assignments: Model<ModeratorAssignment>,
  ) {}
  async getForModerator(userId: string) {
    if (!Types.ObjectId.isValid(userId)) return null;
    const assignment = await this.assignments.findOne({ userId }).lean().exec();
    return assignment
      ? {
          providerType: assignment.providerType,
          providerId: assignment.providerId.toString(),
        }
      : null;
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModeratorAssignment.name, schema: ModeratorAssignmentSchema },
    ]),
  ],
  providers: [ModeratorAssignmentsService],
  exports: [ModeratorAssignmentsService, MongooseModule],
})
export class ModeratorAssignmentsModule {}
