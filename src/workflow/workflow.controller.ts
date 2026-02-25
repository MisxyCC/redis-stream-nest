import { Controller, Post, Body, Sse } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { SubmitDocumentDto, ApproveDocumentDto } from './workflow.dto';
import { WorkflowActionResponse, KanbanBoard } from './workflow.types';
import { Observable, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';

// กำหนด Type ของ MessageEvent ให้ SSE อย่างชัดเจน
interface SseMessageEvent {
  data: KanbanBoard;
}

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post('submit')
  async submit(
    @Body() dto: SubmitDocumentDto,
  ): Promise<WorkflowActionResponse> {
    // ไม่ต้องใช้ if (!body.docId) แล้ว เพราะ ValidationPipe จัดการให้แล้ว
    return this.workflowService.submitDocument(dto.docId, dto.userId);
  }

  @Post('approve')
  async approve(
    @Body() dto: ApproveDocumentDto,
  ): Promise<WorkflowActionResponse> {
    return this.workflowService.approveDocument(dto.docId, dto.approverId);
  }

  @Sse('status-stream')
  statusStream(): Observable<SseMessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const boardData: KanbanBoard =
          await this.workflowService.getKanbanStatus();
        return { data: boardData } as SseMessageEvent;
      }),
    );
  }
}
