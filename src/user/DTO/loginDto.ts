export class LoginDto {
  username: string;
  password: string;
  captcha: string;
}

export class EmailLoginDto {
  email: string;
  emailCode: string;
}
