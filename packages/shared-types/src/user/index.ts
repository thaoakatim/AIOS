export interface IUser {
  id: string;
  keycloakSubject: string | null;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001';

export const DEFAULT_LOCAL_USER: Omit<IUser, 'createdAt' | 'updatedAt'> = {
  id: DEFAULT_LOCAL_USER_ID,
  keycloakSubject: null,
  email: 'local-dev@aios.local',
  displayName: 'Default Local User',
  emailVerified: true,
};
