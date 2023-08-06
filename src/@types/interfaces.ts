export interface IFTPConfig {
    host: string;
    user: string;
    password: string;
    port: number;
}

export interface ISyncConfig extends IFTPConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    localDir: string;
    remoteDir: string;
    patchDir: string;
}