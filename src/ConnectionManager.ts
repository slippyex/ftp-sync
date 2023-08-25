import { Client, FileInfo, StringEncoding } from 'basic-ftp';
import { IFTPConfig, ILoggable } from './@types/interfaces';
import { ProgressHandler } from 'basic-ftp/dist/ProgressTracker';
import * as fs from 'fs';
import { ensureConnection } from './@decorators/ensureConnection';

export class ConnectionManager {
    private readonly client = new Client();
    private readonly logger?: ILoggable;

    constructor(private config: IFTPConfig, logger: ILoggable) {
        this.client.ftp.encoding = (config.defaultEncoding as StringEncoding) || 'latin1';
        this.logger = logger;
    }

    async connect() {
        this.logger?.log('Connecting to FTP server...');
        await this.client.access(this.config);
        await this.client.useDefaultSettings();
        this.logger?.log(`Connection to FTP established`);
    }

    getClient() {
        return this.client;
    }

    getLogger() {
        return this.logger;
    }

    @ensureConnection
    async safeList(remotePath: string): Promise<FileInfo[]> {
        return this.client.list(remotePath);
    }

    @ensureConnection
    async safeDownload(localStream: fs.WriteStream, remoteFilePath: string) {
        await this.client.downloadTo(localStream, remoteFilePath);
    }

    async safeReconnect(maxRetries = 3) {
        for (let retries = 0; retries < maxRetries; retries++) {
            try {
                await this.client.connect();
                return;
            } catch (error) {
                if (retries === maxRetries - 1) {
                    throw new Error('Failed to connect after multiple attempts');
                }
                await this.sleep(2000);
            }
        }
    }

    close() {
        this.client.close();
    }

    trackProgress(handler?: ProgressHandler) {
        return this.client.trackProgress(handler);
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
