import { Gender } from '../entitys/user.entity';

export interface AuthResponseDto {
  accessToken: string;
  userInfo: {
    id: number;
    username: string;
    nickname: string;
    email?: string;
    avatar?: string;
    gender?: Gender;
    province?: string;
    city?: string;
  };
}
