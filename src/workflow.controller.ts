import { Controller, Post, Body, Sse } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { Observable, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';

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

  @Sse('status-stream')
  statusStream(): Observable<MessageEvent> {
    // interval(1000) คือการให้ Server ทำงานทุกๆ 1 วินาที
    return interval(1000).pipe(
      switchMap(async () => {
        // ดึงข้อมูลสถานะล่าสุดจาก Redis
        const data = await this.workflowService.getKanbanStatus();

        // ส่งกลับไปในรูปแบบ MessageEvent ของ SSE
        return { data } as MessageEvent;
      }),
    );
  }
}
