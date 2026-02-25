import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow/workflow.controller';
import { WorkflowService } from './workflow/workflow.service';

@Module({
  imports: [],
  controllers: [WorkflowController],
  providers: [WorkflowService],
})
export class AppModule {}
