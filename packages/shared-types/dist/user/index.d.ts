export interface IUser {
    id: string;
    keycloakSubject: string | null;
    email: string;
    displayName: string | null;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export declare const DEFAULT_LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";
export declare const DEFAULT_LOCAL_USER: Omit<IUser, 'createdAt' | 'updatedAt'>;
//# sourceMappingURL=index.d.ts.map