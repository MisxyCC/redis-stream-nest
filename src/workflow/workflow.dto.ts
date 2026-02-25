import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitDocumentDto {
  @IsString()
  @IsNotEmpty()
  docId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class ApproveDocumentDto {
  @IsString()
  @IsNotEmpty()
  docId: string;

  @IsString()
  @IsNotEmpty()
  approverId: string;
}
