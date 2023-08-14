export interface IFTPConfig {
    host: string;
    user: string;
    password: string;
    port: number;
}

export interface ISyncConfig extends IFTPConfig {
    ftpConfig: IFTPConfig;
    password: string;
    localDir: string;
    remoteDir: string;
    patchDir: string;
}