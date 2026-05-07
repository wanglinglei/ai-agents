import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
@Index(['runId', 'createdAt'])
@Index(['toolName', 'createdAt'])
export class AgentToolCall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    comment: '所属 Agent 运行 ID',
    type: 'uuid',
  })
  runId: string;

  @Column({
    comment: '工具名称',
    length: 100,
    type: 'varchar',
  })
  toolName: string;

  @Column({
    comment: '工具调用状态：running、completed、failed、skipped',
    default: 'running',
    length: 20,
    type: 'varchar',
  })
  status: string;

  @Column({
    comment: '工具入参快照',
    default: () => "'{}'::jsonb",
    type: 'jsonb',
  })
  input: Record<string, unknown>;

  @Column({
    comment: '工具返回结果或摘要',
    nullable: true,
    type: 'jsonb',
  })
  output: Record<string, unknown> | null;

  @Column({
    comment: '工具调用失败信息',
    nullable: true,
    type: 'jsonb',
  })
  error: Record<string, unknown> | null;

  @Column({
    comment: '工具开始调用时间',
    nullable: true,
    type: 'timestamp',
  })
  startedAt: Date | null;

  @Column({
    comment: '工具调用完成时间',
    nullable: true,
    type: 'timestamp',
  })
  completedAt: Date | null;

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
