import { Client, FileInfo, StringEncoding } from 'basic-ftp';
import { IFTPConfig, ILoggable } from './@types/interfaces';
import { ProgressHandler } from 'basic-ftp/dist/ProgressTracker';
import * as fs from 'fs';
import { ensureConnection } from './@decorators/ensureConnection';

export class ConnectionManager {
    private readonly client = new Client();
    private readonly logger?: ILoggable;
    private readonly config: IFTPConfig;
    private isClosed: boolean = true;

    constructor(config: IFTPConfig, logger: ILoggable) {
        this.config = config;
        this.logger = logger;
    }

    async connect() {
        if (this.isClosed) {
            this.logger?.log('Connecting to FTP server...');
            this.client.ftp.encoding = (this.config.defaultEncoding as StringEncoding) || 'latin1';
            await this.client.access(this.config);
            await this.client.useDefaultSettings();
            this.isClosed = false;
            this.logger?.log(`Connection to FTP established`);
        }
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
        let delay = 2000;
        for (let retries = 0; retries < maxRetries; retries++) {
            try {
                if (!this.client.closed)
                    this.close();
                await this.connect();
                return;
            } catch (error) {
                if (retries === maxRetries - 1) {
                    throw new Error('Failed to connect after multiple attempts');
                }
                await this.sleep(delay);
                delay *= 2;
            }
        }
    }

    close() {
        this.isClosed = true;
        this.client.close();
    }

    trackProgress(handler?: ProgressHandler) {
        return this.client.trackProgress(handler);
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
