import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
@Index(['conversationId', 'createdAt'])
@Index(['runId'])
export class AgentMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    comment: '所属会话 ID',
    type: 'uuid',
  })
  conversationId: string;

  @Column({
    comment: '关联 Agent 运行 ID',
    nullable: true,
    type: 'uuid',
  })
  runId: string | null;

  @Column({
    comment: '消息角色：user、assistant、system、tool',
    length: 20,
    type: 'varchar',
  })
  role: string;

  @Column({
    comment: '最终展示文本',
    default: '',
    type: 'text',
  })
  content: string;

  @Column({
    comment: '内容类型：text、markdown、json、image、file_ref',
    default: 'text',
    length: 30,
    type: 'varchar',
  })
  contentType: string;

  @Column({
    comment: '消息状态：streaming、completed、failed、cancelled',
    default: 'completed',
    length: 20,
    type: 'varchar',
  })
  status: string;

  @Column({
    comment:
      '消息附加结构化数据，例如 intent、天气摘要、模型名和 artifact 引用',
    default: () => "'{}'::jsonb",
    type: 'jsonb',
  })
  metadata: Record<string, unknown>;

  @CreateDateColumn({
    comment: '创建时间',
    type: 'timestamp',
  })
  createdAt: Date;

  @UpdateDateColumn({
    comment: '更新时间',
    type: 'timestamp',
  })
  updatedAt: Date;
}
