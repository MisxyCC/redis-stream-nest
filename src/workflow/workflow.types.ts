// โครงสร้างข้อมูลของการ์ด 1 ใบใน Kanban Board
export interface KanbanCard {
  id: string;
  docId: string;
  event: string;
  time: string;
}

// โครงสร้างของ Kanban Board ทั้งกระดาน
export interface KanbanBoard {
  waiting: KanbanCard[];
  processing: KanbanCard[];
  completed: KanbanCard[];
}

// โครงสร้างข้อมูลที่ Redis Stream ตอบกลับมา (หลีกเลี่ยงการใช้ any เด็ดขาด)
// [MessageId, [Field1, Value1, Field2, Value2, ...]]
export type RedisStreamMessage = [string, string[]];

// โครงสร้างของข้อมูลเมื่อถูกแปลงจาก Array ของ Redis มาเป็น Object ของเราแล้ว
export interface DocumentEventPayload {
  event: 'DOCUMENT_SUBMITTED' | 'DOCUMENT_APPROVED';
  docId: string;
  userId?: string;
  approverId?: string;
  timestamp: string;
}

// ผลลัพธ์จากการส่งคำสั่งสร้าง Event
export interface WorkflowActionResponse {
  success: boolean;
  messageId: string;
  status: 'PENDING' | 'APPROVED';
}
