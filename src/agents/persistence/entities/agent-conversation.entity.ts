import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
@Index(['userId', 'agentKey', 'updatedAt'])
@Index(['agentKey', 'updatedAt'])
export class AgentConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    comment: '关联用户 ID，游客或系统调用场景可为空',
    nullable: true,
    type: 'int',
  })
  userId: number | null;

  @Column({
    comment: '会话所属 Agent 业务标识',
    length: 64,
    type: 'varchar',
  })
  agentKey: string;

  @Column({
    comment: '会话标题',
    length: 200,
    nullable: true,
    type: 'varchar',
  })
  title: string | null;

  @Column({
    comment: '会话状态：active、archived、deleted',
    default: 'active',
    length: 20,
    type: 'varchar',
  })
  status: string;

  @Column({
    comment: '下一轮 Agent 调用需要的轻量会话状态',
    default: () => "'{}'::jsonb",
    type: 'jsonb',
  })
  state: Record<string, unknown>;

  @Column({
    comment: '会话扩展信息，例如客户端来源、业务入口和标签',
    default: () => "'{}'::jsonb",
    type: 'jsonb',
  })
  metadata: Record<string, unknown>;

  @Column({
    comment: '最近一条消息时间，用于会话列表排序',
    nullable: true,
    type: 'timestamp',
  })
  lastMessageAt: Date | null;

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
