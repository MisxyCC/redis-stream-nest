import { Controller, Post, Body } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post('submit')
  async submit(@Body() body: { docId: string; userId: string }) {
    if (!body.docId || !body.userId) {
      return {
        success: false,
        message: 'Missing required fields: docId or userId',
      };
    }
    return this.workflowService.submitDocument(body.docId, body.userId);
  }

  @Post('approve')
  async approve(@Body() body: { docId: string; approverId: string }) {
    if (!body.docId || !body.approverId) {
      return {
        success: false,
        message: 'Missing required fields: docId or approverId',
      };
    }
    return this.workflowService.approveDocument(body.docId, body.approverId);
  }
}
