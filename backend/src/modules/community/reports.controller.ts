import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Authenticated,
  CurrentUser,
} from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { PublicUser } from '../users/users.service';
import {
  ContentParamsDto,
  CreateReportDto,
  ReportsQueryDto,
  ResolveReportDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Content reports')
@ApiBadRequestResponse({ description: 'Invalid input' })
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Authenticated('traveler')
  @ApiOperation({
    summary:
      'GEN-09: report a post, comment, review or public itinerary, once per item',
  })
  @ApiNotFoundResponse({ description: 'Content not found or not visible' })
  @ApiConflictResponse({ description: 'Already reported by you' })
  create(@CurrentUser() user: PublicUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }
}

@ApiTags('Moderation')
@ApiBadRequestResponse({ description: 'Invalid input' })
@Controller('admin')
export class ModerationController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @Authenticated('admin')
  @ApiOperation({
    summary: 'GEN-09/GEN-10: list reports (open by default), oldest first',
  })
  list(@Query() query: ReportsQueryDto) {
    return this.reports.list(query);
  }

  @Patch('reports/:id')
  @Authenticated('admin')
  @ApiOperation({
    summary:
      'GEN-10: resolve a report by dismissing it, hiding the content or deleting it',
    description:
      'Hiding or deleting also closes every other open report on the same content.',
  })
  @ApiNotFoundResponse({ description: 'Report or content not found' })
  @ApiConflictResponse({ description: 'Report already resolved' })
  resolve(
    @CurrentUser() admin: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(admin, params.id, dto.action);
  }

  @Patch('content/:type/:id/hide')
  @Authenticated('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'GEN-10: hide any post, comment, review or itinerary',
    description:
      'Hidden content is visible only to its author and admins. A hidden itinerary becomes private.',
  })
  @ApiNoContentResponse({ description: 'Hidden' })
  @ApiNotFoundResponse({ description: 'Content not found' })
  hide(@CurrentUser() admin: PublicUser, @Param() params: ContentParamsDto) {
    return this.reports.moderate(admin, params.type, params.id, 'hide');
  }

  @Delete('content/:type/:id')
  @Authenticated('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'GEN-10: delete any post, comment, review or itinerary',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Content not found' })
  remove(@CurrentUser() admin: PublicUser, @Param() params: ContentParamsDto) {
    return this.reports.moderate(admin, params.type, params.id, 'delete');
  }
}
