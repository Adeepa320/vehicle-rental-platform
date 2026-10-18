import { Module } from '@nestjs/common';

import { AdminSystemController } from './admin-system.controller';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { WorkerStatusService } from './worker-status.service';

@Module({
  controllers: [SystemController, AdminSystemController],
  providers: [SystemService, WorkerStatusService],
})
export class SystemModule {}
