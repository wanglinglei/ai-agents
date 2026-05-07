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
@Index(['agentKey', 'status', 'createdAt'])
export class AgentRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    comment: '所属会话 ID',
    type: 'uuid',
  })
  conversationId: string;

  @Column({
    comment: '本次运行对应的用户消息 ID',
    nullable: true,
    type: 'uuid',
  })
  userMessageId: string | null;

  @Column({
    comment: '本次运行最终生成的助手消息 ID',
    nullable: true,
    type: 'uuid',
  })
  assistantMessageId: string | null;

  @Column({
    comment: '本次运行使用的 Agent 业务标识',
    length: 64,
    type: 'varchar',
  })
  agentKey: string;

  @Column({
    comment: '本次运行使用的大模型名称',
    length: 100,
    nullable: true,
    type: 'varchar',
  })
  model: string | null;

  @Column({
    comment: '模型或能力提供方',
    length: 100,
    nullable: true,
    type: 'varchar',
  })
  provider: string | null;

  @Column({
    comment: '运行状态：pending、running、completed、failed、cancelled',
    default: 'pending',
    length: 20,
    type: 'varchar',
  })
  status: string;

  @Column({
    comment: '本次运行输入快照',
    default: () => "'{}'::jsonb",
    type: 'jsonb',
  })
  input: Record<string, unknown>;

  @Column({
    comment: '本次运行最终结构化输出',
    default: () => "'{}'::jsonb",
    type: 'jsonb',
  })
  output: Record<string, unknown>;

  @Column({
    comment: '失败信息',
    nullable: true,
    type: 'jsonb',
  })
  error: Record<string, unknown> | null;

  @Column({
    comment: '实际开始执行时间',
    nullable: true,
    type: 'timestamp',
  })
  startedAt: Date | null;

  @Column({
    comment: '执行完成时间',
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
