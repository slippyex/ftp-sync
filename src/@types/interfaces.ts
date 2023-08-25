export interface IFTPConfig {
    host: string;
    user: string;
    password: string;
    port: number;
    defaultEncoding: string;
}

export interface ISyncConfig extends IFTPConfig {
    ftpConfig: IFTPConfig;
    password: string;
    localDir: string;
    remoteDir: string;
    patchDir: string;
}
export interface IStatusEntries {
    processingRate: string;
    elapsedTime: string;
    fileCounter: number;
    syncCounter: number;
    downloadMsg: string;
}

export interface ILoggable {
    log: (...args: unknown[]) => void;
}
