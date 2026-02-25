import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
  KanbanBoard,
  KanbanCard,
  RedisStreamMessage,
  DocumentEventPayload,
  WorkflowActionResponse,
} from './workflow.types';

@Injectable()
export class WorkflowService implements OnModuleInit, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(WorkflowService.name);

  private readonly streamKey = 'workflow:document_stream';
  private readonly groupName = 'approval_workers_group';
  private readonly consumerName = `worker_${process.pid}`;

  private isShuttingDown = false;
  private recoveryInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.redis = new Redis({ host: '127.0.0.1', port: 6379 });
  }

  async onModuleInit(): Promise<void> {
    await this.initConsumerGroup();
    void this.startListening();
    this.startRecoveryLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    await this.redis.quit();
  }

  private async initConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        'CREATE',
        this.streamKey,
        this.groupName,
        '0',
        'MKSTREAM',
      );
    } catch (error: unknown) {
      if (error instanceof Error && !error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  async submitDocument(
    docId: string,
    userId: string,
  ): Promise<WorkflowActionResponse> {
    const messageId = await this.redis.xadd(
      this.streamKey,
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'DOCUMENT_SUBMITTED',
      'docId',
      docId,
      'userId',
      userId,
      'timestamp',
      new Date().toISOString(),
    );
    if (!messageId) {
      throw new Error('Failed to add message to Redis stream');
    }
    return { success: true, messageId, status: 'PENDING' };
  }

  async approveDocument(
    docId: string,
    approverId: string,
  ): Promise<WorkflowActionResponse> {
    const messageId = await this.redis.xadd(
      this.streamKey,
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'DOCUMENT_APPROVED',
      'docId',
      docId,
      'approverId',
      approverId,
      'timestamp',
      new Date().toISOString(),
    );
    if (!messageId) {
      throw new Error('Failed to add message to Redis stream');
    }
    return { success: true, messageId, status: 'APPROVED' };
  }

  private async startListening(): Promise<void> {
    while (!this.isShuttingDown) {
      try {
        const results = (await this.redis.xreadgroup(
          'GROUP',
          this.groupName,
          this.consumerName,
          'BLOCK',
          5000,
          'STREAMS',
          this.streamKey,
          '>',
        )) as Array<[string, RedisStreamMessage[]]> | null;

        if (results && results.length > 0) {
          const streamMessages = results[0][1];
          for (const message of streamMessages) {
            await this.processAndAckMessage(message);
          }
        }
      } catch (error: unknown) {
        if (this.isShuttingDown) break;
        this.logger.error(
          'Stream processing error:',
          error instanceof Error ? error.message : String(error),
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private startRecoveryLoop(): void {
    this.recoveryInterval = setInterval(() => {
      if (this.isShuttingDown) return;
      void this.recoverStuckMessages();
    }, 60000);
  }

  private async recoverStuckMessages(): Promise<void> {
    try {
      // xautoclaim คืนค่าเป็น Tuple [startId, ArrayOfMessages, ArrayOfDeletedIds]
      const result = (await this.redis.xautoclaim(
        this.streamKey,
        this.groupName,
        this.consumerName,
        60000,
        '0-0',
        'COUNT',
        50,
      )) as [string, RedisStreamMessage[], string[]];

      const claimedMessages = result[1];
      if (claimedMessages && claimedMessages.length > 0) {
        this.logger.warn(
          `Recovered ${claimedMessages.length} stuck messages. Reprocessing...`,
        );
        for (const message of claimedMessages) {
          await this.processAndAckMessage(message);
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        'Error during message recovery:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async processAndAckMessage(
    message: RedisStreamMessage,
  ): Promise<void> {
    const [messageId, fields] = message;

    // แปลง String Array กลับมาเป็น Object แบบ Strongly Typed
    const payloadInfo: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      payloadInfo[fields[i]] = fields[i + 1];
    }
    const payload = payloadInfo as unknown as DocumentEventPayload;

    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      await this.redis.xack(this.streamKey, this.groupName, messageId);
      this.logger.log(`Acknowledged: ${messageId} (${payload.event})`);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to process: ${messageId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async getKanbanStatus(): Promise<KanbanBoard> {
    const kanban: KanbanBoard = { waiting: [], processing: [], completed: [] };

    try {
      const messages = (await this.redis.xrevrange(
        this.streamKey,
        '+',
        '-',
        'COUNT',
        50,
      )) as RedisStreamMessage[];

      let lastDeliveredId = '0-0';
      try {
        const groupsInfo = (await this.redis.xinfo(
          'GROUPS',
          this.streamKey,
        )) as Array<Array<string | number>>;
        const myGroup = groupsInfo.find((g) => g.includes(this.groupName));
        if (myGroup) {
          const idx = myGroup.indexOf('last-delivered-id');
          if (idx !== -1) lastDeliveredId = String(myGroup[idx + 1]);
        }
      } catch {
        /* Ignore if group doesn't exist */
      }

      const pendingIds = new Set<string>();
      try {
        const pendingInfo = (await this.redis.xpending(
          this.streamKey,
          this.groupName,
          '-',
          '+',
          100,
        )) as Array<[string, string, number, number]>;
        pendingInfo.forEach((p) => pendingIds.add(p[0]));
      } catch {
        /* Ignore */
      }

      for (const msg of messages) {
        const [id, fields] = msg;
        const payloadInfo: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          payloadInfo[fields[i]] = fields[i + 1];
        }

        const card: KanbanCard = {
          id,
          docId: payloadInfo.docId || 'Unknown',
          event: payloadInfo.event || 'Unknown',
          time: payloadInfo.timestamp || new Date().toISOString(),
        };

        if (pendingIds.has(id)) {
          kanban.processing.push(card);
        } else if (id > lastDeliveredId) {
          kanban.waiting.push(card);
        } else {
          kanban.completed.push(card);
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        'Error fetching Kanban status',
        error instanceof Error ? error.message : String(error),
      );
    }

    return kanban;
  }
}
