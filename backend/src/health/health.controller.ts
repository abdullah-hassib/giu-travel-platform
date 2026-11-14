import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  @Get('live')
  @ApiOperation({ summary: 'Process liveness, independent of database' })
  live(): { status: string } { return { status: 'ok' }; }
  @Get('ready')
  @ApiOperation({ summary: 'Readiness depends on MongoDB connection' })
  ready(): { status: string; database: string } {
    if (this.connection.readyState !== 1) throw new ServiceUnavailableException('Database is not connected');
    return { status: 'ok', database: 'connected' };
  }
}
