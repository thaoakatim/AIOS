import { IUser } from '@aios/shared-types';

export interface AuthMeResponseDto {
  user: IUser;
  authMode: 'keycloak' | 'dev_bypass';
}

export interface LogoutResponseDto {
  success: boolean;
  message: string;
}
