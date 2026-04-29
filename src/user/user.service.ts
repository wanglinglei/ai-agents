import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Request as ExpressRequest } from 'express';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { GeneralService } from '../general/general.service';
import {
  AuthResponseDto,
  EmailLoginDto,
  LoginDto,
  RegisterDto,
  UpdateUserDto,
  UserListDto,
} from './DTO';
import { Gender, User, UserSource, UserStatus } from './entitys/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private generalService: GeneralService,
  ) {}

  /**
   * 用户注册。
   *
   * @param registerDto 注册参数。
   * @param req Express 请求对象。
   * @returns 是否注册成功。
   */
  async register(
    registerDto: RegisterDto,
    req: ExpressRequest,
  ): Promise<boolean> {
    const {
      username,
      password,
      nickname = '',
      email,
      avatar,
      gender,
      captcha,
    } = registerDto;
    if (!this.generalService.verifyCaptcha(req.session, captcha)) {
      throw new BadRequestException('验证码错误或已过期');
    }

    const existingUserByUsername = await this.userRepository.findOne({
      where: { username },
    });
    if (existingUserByUsername) {
      throw new ConflictException('用户名已存在');
    }

    if (email) {
      const existingUserByEmail = await this.userRepository.findOne({
        where: { email },
      });
      if (existingUserByEmail) {
        throw new ConflictException('邮箱已被注册');
      }
    }

    const hashedPassword = await this.hashPassword(password);
    let genderEnum: Gender = Gender.UNKNOWN;
    if (gender === 'male') {
      genderEnum = Gender.MALE;
    } else if (gender === 'female') {
      genderEnum = Gender.FEMALE;
    }

    const user = this.userRepository.create({
      username,
      password: hashedPassword,
      nickname,
      email,
      avatar:
        avatar ||
        'https://p3-passport.byteacctimg.com/img/user-avatar/5a3f65c1808beb286a51c56d7a0903b4~80x80.awebp',
      gender: genderEnum,
      source: UserSource.WEB,
    });

    await this.userRepository.save(user);
    return true;
  }

  /**
   * 用户名密码登录。
   *
   * @param loginDto 登录参数。
   * @param req Express 请求对象。
   * @returns 登录响应。
   */
  async login(
    loginDto: LoginDto,
    req: ExpressRequest,
  ): Promise<AuthResponseDto> {
    const { username, password, captcha } = loginDto;
    if (!this.generalService.verifyCaptcha(req.session, captcha)) {
      throw new BadRequestException('验证码错误或已过期');
    }

    const user = await this.findByUsernameWithPassword(username);
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const isPasswordValid = await this.validatePassword(
      password,
      user.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException('账户已被禁用');
    }

    const accessToken = this.generateToken(user);
    return {
      accessToken,
      userInfo: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        email: user.email,
        avatar: user.avatar,
        gender: user.gender,
        province: user.province,
        city: user.city,
      },
    };
  }

  /**
   * 邮箱验证码登录。
   *
   * @param emailLoginDto 登录参数。
   * @param req Express 请求对象。
   * @returns 登录响应。
   */
  async emailLogin(
    emailLoginDto: EmailLoginDto,
    req: ExpressRequest,
  ): Promise<AuthResponseDto> {
    const { email, emailCode } = emailLoginDto;
    if (!this.generalService.verifyEmailCode(req.session, email, emailCode)) {
      throw new BadRequestException('邮箱验证码错误或已过期');
    }

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException('账户已被禁用');
    }

    const accessToken = this.generateToken(user);
    return {
      accessToken,
      userInfo: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        email: user.email,
        avatar: user.avatar,
        gender: user.gender,
        province: user.province,
        city: user.city,
      },
    };
  }

  /**
   * 更新用户信息。
   *
   * @param updateDto 更新参数。
   * @param req Express 请求对象。
   * @returns 更新后的用户。
   */
  async update(updateDto: UpdateUserDto, req: ExpressRequest): Promise<User> {
    const { id, username, email, emailCode } = updateDto;
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (emailCode && email) {
      if (!this.generalService.verifyEmailCode(req.session, email, emailCode)) {
        throw new BadRequestException('邮箱验证码错误或已过期');
      }
    }

    const existingUser = await this.userRepository.findOne({
      where: { username },
    });
    if (existingUser && existingUser.id !== id) {
      throw new ConflictException('用户名已存在');
    }

    if (email) {
      const existingUserByEmail = await this.userRepository.findOne({
        where: { email },
      });
      if (existingUserByEmail && existingUserByEmail.id !== id) {
        throw new ConflictException('邮箱已被注册');
      }
    }

    const updateUser: User = {
      ...user,
      ...updateDto,
    };
    return this.userRepository.save(updateUser);
  }

  /**
   * 根据用户名查询用户（不含密码）。
   *
   * @param username 用户名。
   * @returns 用户信息。
   */
  async findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { username } });
  }

  /**
   * 根据用户名查询用户（包含密码）。
   *
   * @param username 用户名。
   * @returns 用户信息。
   */
  async findByUsernameWithPassword(username: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .where('user.username = :username', { username })
      .addSelect('user.password')
      .getOne();
  }

  /**
   * 按用户 ID 查询。
   *
   * @param id 用户 ID。
   * @returns 用户信息。
   */
  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  /**
   * 按来源用户 ID 查询。
   *
   * @param sourceUserId 外部来源用户 ID。
   * @returns 用户信息。
   */
  async findBySourceUserId(sourceUserId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { sourceUserId } });
  }

  /**
   * 创建支付宝来源用户。
   *
   * @param userData 用户数据。
   * @returns 创建后的用户。
   */
  async createAlipayUser(userData: {
    username: string | null;
    nickname: string;
    alipayUserId: string;
    avatar?: string;
    gender?: 'male' | 'female' | 'unknown';
    province?: string;
    city?: string;
  }): Promise<User> {
    let genderEnum: Gender = Gender.UNKNOWN;
    if (userData.gender === 'male') {
      genderEnum = Gender.MALE;
    } else if (userData.gender === 'female') {
      genderEnum = Gender.FEMALE;
    }

    const user = this.userRepository.create({
      username: userData.username ?? undefined,
      password: await this.hashPassword(crypto.randomBytes(16).toString('hex')),
      nickname: userData.nickname,
      avatar: userData.avatar,
      gender: genderEnum,
      source: UserSource.ALIPAY,
      sourceUserId: userData.alipayUserId,
      province: userData.province,
      city: userData.city,
    });

    return this.userRepository.save(user);
  }

  /**
   * 更新用户实体。
   *
   * @param user 用户实体。
   * @returns 更新后的用户。
   */
  async updateUser(user: User): Promise<User> {
    return this.userRepository.save(user);
  }

  /**
   * 获取用户列表。
   *
   * @param userListDto 分页参数。
   * @returns 列表与分页信息。
   */
  async getUserList(userListDto: UserListDto): Promise<{
    list: User[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { page = 1, pageSize = 10 } = userListDto;
    const skip = (page - 1) * pageSize;
    const take = pageSize;
    const userList = await this.userRepository.find({ skip, take });
    const total = await this.userRepository.count();
    return {
      list: userList,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 生成 JWT token。
   *
   * @param user 用户对象。
   * @param expiresIn 有效期。
   * @returns token 字符串。
   */
  generateToken(user: User, expiresIn?: string): string {
    const payload = { sub: user.id };
    const expires = expiresIn || process.env.JWT_EXPIRES_IN || '1d';
    return this.jwtService.sign(payload, { expiresIn: expires } as any);
  }

  /**
   * 加密密码。
   *
   * @param password 明文密码。
   * @returns 密文。
   */
  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * 校验密码。
   *
   * @param password 明文密码。
   * @param hashedPassword 密文密码。
   * @returns 是否匹配。
   */
  private async validatePassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
}
