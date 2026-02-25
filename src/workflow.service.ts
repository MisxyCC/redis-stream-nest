import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';

type RedisStreamMessage = [string, string[]];

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
    void this.startListening();
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
    } catch (error: unknown) {
      if (error instanceof Error && !error.message.includes('BUSYGROUP')) {
        throw error;
      }
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
        const results = (await this.redis.xreadgroup(
          'GROUP',
          this.groupName,
          this.consumerName,
          'BLOCK',
          5000,
          'STREAMS',
          this.streamKey,
          '>',
        )) as [string, RedisStreamMessage[]][] | null;
        if (results && results.length > 0) {
          const streamMessages = results[0][1];
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
    this.recoveryInterval = setInterval(() => {
      if (this.isShuttingDown) return;
      void this.recoverStuckMessages().catch((error) => {
        this.logger.error('Error during message recovery loop:', error);
      });
    }, 60000);
  }

  private async recoverStuckMessages() {
    try {
      const result = (await this.redis.xautoclaim(
        this.streamKey,
        this.groupName,
        this.consumerName,
        60000,
        '0-0',
        'COUNT',
        50,
      )) as [string, RedisStreamMessage[]];
      const claimedMessages = result[1];
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

  private async processAndAckMessage(message: RedisStreamMessage) {
    const [messageId, fields] = message;
    const payload: Record<string, string> = {};
    //แกล้งถ่วงเวลา Worker 3 วินาที เพื่อให้มองเห็นการ์ดในสถานะ Processing บนหน้าเว็บ
    await new Promise((resolve) => setTimeout(resolve, 3000));

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

  async getKanbanStatus() {
    const kanban: {
      waiting: Record<string, unknown>[];
      processing: Record<string, unknown>[];
      completed: Record<string, unknown>[];
    } = {
      waiting: [],
      processing: [],
      completed: [],
    };
    try {
      // 1. ดึงข้อความทั้งหมดใน Stream (ดึงมาแค่ 50 รายการล่าสุดเพื่อประสิทธิภาพ)
      const messages = await this.redis.xrange(
        this.streamKey,
        '+',
        '-',
        'COUNT',
        50,
      );
      // 2. หาว่าข้อความล่าสุดที่ Group นี้อ่านไปแล้วคือ ID อะไร
      let lastDeliveredId = '0-0';
      try {
        const groupInfo = (await this.redis.xinfo(
          'GROUPS',
          this.streamKey,
        )) as unknown[][];
        const targetGroup = groupInfo.find((g) => g.includes(this.groupName));
        if (targetGroup) {
          const idx = targetGroup.indexOf('last-delivered-id');
          if (idx !== -1) {
            lastDeliveredId = targetGroup[idx + 1] as string;
          }
        }
      } catch {
        // ข้ามไปถ้ายังไม่มี Group
      }
      // 3. หาข้อความที่ค้างอยู่ (Pending) ใน Group นี้
      const pendingIds: Set<string> = new Set<string>();
      try {
        const pendingInfo = (await this.redis.xpending(
          this.streamKey,
          this.groupName,
          '-',
          '+',
          100,
        )) as [string, string, number, number][];
        pendingInfo.forEach((p) => pendingIds.add(p[0]));
      } catch {
        // ละเว้น
      }

      // 4. คัดแยกสถานะ
      for (const message of messages) {
        const [id, fields] = message;
        const payload: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          payload[fields[i]] = fields[i + 1];
        }
        const card = {
          id,
          docId: payload['docId'],
          event: payload['event'],
          time: payload['timestamp'],
        };
        if (pendingIds.has(id)) {
          kanban.processing.push(card);
        } else if (id > lastDeliveredId) {
          kanban.waiting.push(card);
        } else {
          kanban.completed.push(card);
        }
      }
    } catch (error) {
      this.logger.error('Error fetching Kanban status', error);
    }
    return kanban;
  }
}
