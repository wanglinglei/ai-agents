export class RegisterDto {
  username: string;
  password: string;
  nickname?: string;
  email?: string;
  avatar?: string;
  gender?: 'male' | 'female' | 'unknown';
  captcha: string;
}
