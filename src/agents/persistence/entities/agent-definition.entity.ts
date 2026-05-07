import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class AgentDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    comment: 'Agent 唯一业务标识，例如 weather、general、image',
    length: 64,
    type: 'varchar',
    unique: true,
  })
  agentKey: string;

  @Column({
    comment: 'Agent 展示名称',
    length: 100,
    type: 'varchar',
  })
  name: string;

  @Column({
    comment: 'Agent 能力说明',
    nullable: true,
    type: 'text',
  })
  description: string | null;

  @Column({
    comment: 'Agent 启停状态：enabled、disabled、deprecated',
    default: 'enabled',
    length: 20,
    type: 'varchar',
  })
  status: string;

  @Column({
    comment: 'Agent 默认配置，例如模型、工具、上下文轮数和能力开关',
    default: () => "'{}'::jsonb",
    type: 'jsonb',
  })
  config: Record<string, unknown>;

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
