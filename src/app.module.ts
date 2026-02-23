import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [],
  controllers: [AppController, WorkflowController],
  providers: [AppService, WorkflowService],
})
export class AppModule {}
