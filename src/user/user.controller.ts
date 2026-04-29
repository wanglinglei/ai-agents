import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { JwtUser } from '../common/guards/jwt-auth.guard';
import {
  EmailLoginDto,
  LoginDto,
  RegisterDto,
  UpdateUserDto,
  UserListDto,
} from './DTO';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * 健康检查接口。
   *
   * @returns 固定字符串。
   */
  @Get('/health')
  health(): string {
    return 'ok';
  }

  /**
   * 用户注册接口。
   *
   * @param registerDto 注册参数。
   * @param req Express 请求对象。
   * @returns 注册结果。
   */
  @Post('/register')
  async register(
    @Body() registerDto: RegisterDto,
    @Request() req: any,
  ): Promise<boolean> {
    return this.userService.register(registerDto, req);
  }

  /**
   * 用户名密码登录。
   *
   * @param loginDto 登录参数。
   * @param req Express 请求对象。
   * @returns 登录响应。
   */
  @Post('/login')
  async login(
    @Body() loginDto: LoginDto,
    @Request() req: any,
  ): ReturnType<UserService['login']> {
    return this.userService.login(loginDto, req);
  }

  /**
   * 邮箱验证码登录。
   *
   * @param emailLoginDto 邮箱登录参数。
   * @param req Express 请求对象。
   * @returns 登录响应。
   */
  @Post('emailLogin')
  emailLogin(
    @Body() emailLoginDto: EmailLoginDto,
    @Request() req: any,
  ): ReturnType<UserService['emailLogin']> {
    return this.userService.emailLogin(emailLoginDto, req);
  }

  /**
   * 更新用户信息。
   *
   * @param updateDto 更新参数。
   * @param req Express 请求对象。
   * @returns 更新后的用户。
   */
  @Post('/update')
  async update(
    @Body() updateDto: UpdateUserDto,
    @Request() req: any,
  ): ReturnType<UserService['update']> {
    return this.userService.update(updateDto, req);
  }

  /**
   * 获取当前用户资料。
   *
   * @param req 已鉴权请求对象。
   * @returns 用户信息。
   */
  @Get('/profile')
  async getProfile(
    @Request() req: { user: JwtUser },
  ): Promise<Record<string, unknown>> {
    const user = await this.userService.findById(req.user.userId);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      avatar: user.avatar,
      gender: user.gender,
      source: user.source,
      status: user.status,
      authScope: user.authScope,
      createdAt: user.createdAt,
    };
  }

  /**
   * 获取用户列表（管理员）。
   *
   * @param userListDto 分页参数。
   * @returns 用户列表与总数。
   */
  @Get('admin/userList')
  async getUserList(
    @Query() userListDto: UserListDto,
  ): ReturnType<UserService['getUserList']> {
    return this.userService.getUserList(userListDto);
  }
}
