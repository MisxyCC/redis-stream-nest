import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';

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
    // เชื่อมต่อ Redis (ปรับเป็นชื่อ Host ของคุณหากใช้ Docker Network)
    this.redis = new Redis({ host: '127.0.0.1', port: 6379 });
  }

  async onModuleInit() {
    await this.initConsumerGroup();
    this.startListening();
    this.startRecoveryLoop();
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down stream worker safely...');
    this.isShuttingDown = true;
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    await this.redis.quit();
  }

  private async initConsumerGroup() {
    try {
      await this.redis.xgroup(
        'CREATE',
        this.streamKey,
        this.groupName,
        '0',
        'MKSTREAM',
      );
      this.logger.log(`Consumer group '${this.groupName}' initialized.`);
    } catch (error: any) {
      if (!error.message.includes('BUSYGROUP')) throw error;
    }
  }

  // ==========================================
  // Producer
  // ==========================================

  async submitDocument(docId: string, userId: string) {
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
    return { success: true, messageId, status: 'PENDING' };
  }

  async approveDocument(docId: string, approverId: string) {
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
    return { success: true, messageId, status: 'APPROVED' };
  }

  // ==========================================
  // Consumer
  // ==========================================

  private async startListening() {
    while (!this.isShuttingDown) {
      try {
        const results = await this.redis.xreadgroup(
          'GROUP',
          this.groupName,
          this.consumerName,
          'BLOCK',
          5000,
          'STREAMS',
          this.streamKey,
          '>',
        );

        if (results && results.length > 0) {
          const streamMessages = (results[0] as any)[1] as any[];
          for (const message of streamMessages) {
            await this.processAndAckMessage(message);
          }
        }
      } catch (error) {
        if (this.isShuttingDown) break;
        this.logger.error('Stream processing error:', error);
        // ดีเลย์เล็กน้อยเพื่อป้องกันลูปทำงานรัวเกินไปหาก Redis ล่ม
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private startRecoveryLoop() {
    this.recoveryInterval = setInterval(async () => {
      if (this.isShuttingDown) return;
      await this.recoverStuckMessages();
    }, 60000);
  }

  private async recoverStuckMessages() {
    try {
      const result = await this.redis.xautoclaim(
        this.streamKey,
        this.groupName,
        this.consumerName,
        60000,
        '0-0',
        'COUNT',
        50,
      );
      const claimedMessages = result[1] as any[];
      if (claimedMessages && claimedMessages.length > 0) {
        this.logger.warn(
          `Recovered ${claimedMessages.length} stuck messages. Reprocessing...`,
        );
        for (const message of claimedMessages) {
          await this.processAndAckMessage(message);
        }
      }
    } catch (error) {
      this.logger.error('Error during message recovery:', error);
    }
  }

  private async processAndAckMessage(message: any) {
    const [messageId, fields] = message;
    const payload: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2)
      payload[fields[i]] = fields[i + 1];

    try {
      if (payload.event === 'DOCUMENT_SUBMITTED') {
        this.logger.log(
          `[Job] Notifying Manager for Doc: ${payload.docId} (User: ${payload.userId})`,
        );
      } else if (payload.event === 'DOCUMENT_APPROVED') {
        this.logger.log(
          `[Job] Generating PDF for Doc: ${payload.docId} (Approver: ${payload.approverId})`,
        );
      }

      await this.redis.xack(this.streamKey, this.groupName, messageId);
      this.logger.log(`Acknowledged message: ${messageId}`);
    } catch (error) {
      this.logger.error(`Failed to process message ${messageId}:`, error);
    }
  }
}
