import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserSource {
  WECHAT = 'wechat',
  ALIPAY = 'alipay',
  WEB = 'web',
  OTHER = 'other',
}

export enum UserStatus {
  DISABLED = 'disabled',
  ENABLED = 'enabled',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  UNKNOWN = 'unknown',
}

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 10,
    unique: true,
    nullable: true,
    comment: '用户名',
    default: null,
  })
  username: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    unique: true,
    comment: '邮箱',
  })
  email: string;

  @Column({
    type: 'varchar',
    length: 255,
    comment: '密码（加密）',
    select: false,
  })
  password: string;

  @Column({
    type: 'varchar',
    length: 10,
    comment: '用户昵称',
  })
  nickname: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '用户头像URL',
  })
  avatar: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '授权范围',
    default: 'chat,image,video,docx',
  })
  authScope: string;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
    comment: '省份',
  })
  province: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: '城市',
  })
  city: string;

  @Column({
    type: 'enum',
    enum: UserSource,
    default: UserSource.OTHER,
    comment: '用户来源',
  })
  source: UserSource;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ENABLED,
    comment: '用户状态',
  })
  status: UserStatus;

  @Column({
    type: 'enum',
    enum: Gender,
    default: Gender.UNKNOWN,
    comment: '性别',
  })
  gender: Gender;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '来源用户ID',
  })
  sourceUserId: string;

  @CreateDateColumn({
    type: 'timestamp',
    comment: '创建时间',
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    comment: '更新时间',
  })
  updatedAt: Date;
}
