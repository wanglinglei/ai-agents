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
@Index(['messageId'])
export class AgentArtifact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    comment: '所属会话 ID',
    type: 'uuid',
  })
  conversationId: string;

  @Column({
    comment: '关联展示该产物的消息 ID',
    nullable: true,
    type: 'uuid',
  })
  messageId: string | null;

  @Column({
    comment: '关联生成该产物的运行 ID',
    nullable: true,
    type: 'uuid',
  })
  runId: string | null;

  @Column({
    comment: '产物类型：weather_result、image、file、chart_data、tool_result',
    length: 50,
    type: 'varchar',
  })
  artifactType: string;

  @Column({
    comment: '产物标题',
    length: 200,
    nullable: true,
    type: 'varchar',
  })
  title: string | null;

  @Column({
    comment: '结构化产物数据',
    default: () => "'{}'::jsonb",
    type: 'jsonb',
  })
  data: Record<string, unknown>;

  @Column({
    comment: '外部存储地址',
    nullable: true,
    type: 'text',
  })
  storageUrl: string | null;

  @Column({
    comment: '产物扩展信息，例如 mime type、大小、来源工具和缓存过期时间',
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
