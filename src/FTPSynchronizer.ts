import * as fs from 'fs-extra';
import { FileInfo, FileType } from 'basic-ftp';
import * as path from 'path';
import dayjs from 'dayjs';
import { IStatusEntries, ISyncConfig } from './@types/interfaces';
import chalk from 'chalk';
import { FTPUserInterface } from './FTPUserInterface';
import { ConnectionManager } from './ConnectionManager';

export class FtpSynchronizer {
    private static readonly HOUR_IN_MS = 60 * 60 * 1000;
    private static readonly MINUTE_IN_MS = 60 * 1000;

    private readonly config: ISyncConfig;
    private readonly localDir: string;
    private readonly remoteDir: string;
    private readonly patchDir: string;
    private readonly ui: FTPUserInterface;
    private readonly conn: ConnectionManager;
    private isSyncRunning = false;
    private statusEntries: IStatusEntries = {
        fileCounter: 0,
        syncCounter: 0,
        downloadMsg: '-',
        elapsedTime: '00:00:00',
        processingRate: ''
    };
    private lastFTPOperationTimestamp = dayjs();
    private syncStartTime: Date | null = null;
    private timerInterval: NodeJS.Timeout | null = null;
    private isSafetyDownload = false;

    constructor(configFileName: string) {
        this.config = this.getConfig(configFileName);
        this.localDir = this.config.localDir;
        this.remoteDir = this.config.remoteDir;
        this.patchDir = this.config.patchDir;
        this.ui = new FTPUserInterface(this.config);
        this.conn = new ConnectionManager(this.config.ftpConfig, this.ui.logBox);

        this.initializeScreen();
    }

    private initializeScreen() {
        this.ui.screen.key(['q', 'C-c'], () => this.ui.createQuitConfirm());
        this.ui.screen.key(['s', 'x'], this.handleKeyPress.bind(this));
        this.ui.screen.key(['r'], this.handleKeyPress.bind(this));
        this.ui.screen.render();
    }

    private startTimer() {
        this.timerInterval = setInterval(() => {
            this.statusEntries.elapsedTime = this.getElapsedTime();
            this.statusEntries.processingRate = this.getProcessingRate();
            this.ui.updateStatusBox(this.statusEntries);
        }, 1000); // Update every second
    }

    private async handleKeyPress(_: never, key: { name: string }) {
        switch (key.name) {
            case 's':
                if (!this.isSyncRunning) {
                    this.syncStartTime = new Date();
                    this.startTimer();

                    this.syncFTPToLocal().catch(error => {
                        this.ui.logBox.log(`Error: ${error.message}`);
                        this.ui.screen.render();
                    });
                }
                break;
            case 'r':
                this.ui.logBox.add(`reconnecting to remote server`);
                this.isSyncRunning = false;
                await this.conn.safeReconnect();
                this.isSyncRunning = true;
                break;
            case 'x':
                if (this.isSyncRunning) {
                    this.ui.logBox.add(`processing stopped...`);
                    clearInterval(this.timerInterval);
                    this.isSyncRunning = false;
                } else {
                    this.ui.logBox.add(`processing continues...`);
                    this.startTimer();
                    this.isSyncRunning = true;
                }
                break;
        }
    }

    private getConfig(filePath: string): ISyncConfig {
        const configPath = path.join(__dirname, '..', 'configs', filePath);
        if (!fs.existsSync(configPath)) {
            console.error(`provided config file ${filePath} doesn't exist - exiting`);
            process.exit(0);
        }
        const configData = fs.readFileSync(configPath).toString();
        return JSON.parse(configData) as ISyncConfig;
    }

    private ftpPath(...segments: string[]): string {
        return path.posix.join(...segments);
    }

    private getProcessingRate(): string {
        if (!this.syncStartTime) return '0 files/s';
        const now = new Date();
        const diffSeconds = (now.getTime() - this.syncStartTime.getTime()) / 1000;
        const rate = this.statusEntries.fileCounter / diffSeconds;
        return `${rate.toFixed(2)} files/s`;
    }

    private getElapsedTime(): string {
        if (!this.syncStartTime) return '00:00:00';

        const diff = new Date().getTime() - this.syncStartTime.getTime(); // difference in milliseconds

        const hours = Math.floor(diff / FtpSynchronizer.HOUR_IN_MS);
        const minutes = Math.floor((diff % FtpSynchronizer.HOUR_IN_MS) / FtpSynchronizer.MINUTE_IN_MS);
        const seconds = Math.floor((diff % FtpSynchronizer.MINUTE_IN_MS) / 1000);

        return `${this.formatTimeComponent(hours)}:${this.formatTimeComponent(minutes)}:${this.formatTimeComponent(
            seconds
        )}`;
    }

    private formatTimeComponent(value: number): string {
        return String(value).padStart(2, '0');
    }

    private hasElapsedOneMinuteSinceLastOperation(): boolean {
        return dayjs().subtract(1, 'minute').isAfter(this.lastFTPOperationTimestamp);
    }

    private async shouldDownloadFile(
        localFilePath: string,
        remoteFile: FileInfo,
        patchFilePath: string
    ): Promise<boolean> {
        this.statusEntries.fileCounter++;

        const elapsedOneMinute = this.hasElapsedOneMinuteSinceLastOperation();
        if (elapsedOneMinute) {
            this.ui.logBox.log(`--- safety sync ---`);
            this.isSafetyDownload = true;
        }

        if (await this.shouldDownloadBasedOnPath(localFilePath, remoteFile.size, elapsedOneMinute)) {
            return true;
        }

        if (await this.shouldDownloadBasedOnPath(patchFilePath, remoteFile.size, elapsedOneMinute)) {
            return true;
        }

        return !(await fs.pathExists(localFilePath));
    }

    private async shouldDownloadBasedOnPath(
        filePath: string,
        remoteSize: number,
        elapsedOneMinute: boolean
    ): Promise<boolean> {
        if (await fs.pathExists(filePath)) {
            const fileStats = await fs.stat(filePath);
            return fileStats.size !== remoteSize || elapsedOneMinute;
        }
        return false;
    }

    private async waitForContinueFlag() {
        return new Promise(resolve => {
            const checkInterval = setInterval(() => {
                if (this.isSyncRunning) {
                    clearInterval(checkInterval);
                    resolve(null);
                }
            }, 100); // checking every 100ms
        });
    }

    private async traverseAndSync(localPath: string, remotePath: string, patchBasePath: string) {
        const remoteFiles = await this.conn.safeList(remotePath);
        for (const remoteFile of remoteFiles) {
            await this.waitForContinueFlag();

            if (remoteFile.name === '.' || remoteFile.name === '..') continue;

            const localFilePath = path.join(localPath, remoteFile.name);
            const remoteFilePath = this.ftpPath(remotePath, remoteFile.name);
            const relativePathFromStart = path.relative(this.localDir, localFilePath);
            const patchFilePath = path.join(patchBasePath, relativePathFromStart);

            if (remoteFile.type === FileType.Directory) {
                this.updateCurrentDirectory(remoteFilePath);
                await this.traverseAndSync(localFilePath, remoteFilePath, patchBasePath);
            } else {
                await this.handleFileDownload(localFilePath, remoteFile, patchFilePath, remoteFilePath);
            }

            this.ui.screen.render();
        }
    }

    private updateCurrentDirectory(remoteFilePath: string) {
        this.ui.currentDirectoryBox.setText(`current remote directory: ${remoteFilePath}`);
    }

    private async handleFileDownload(
        localFilePath: string,
        remoteFile: FileInfo,
        patchFilePath: string,
        remoteFilePath: string
    ) {
        if (!(await this.shouldDownloadFile(localFilePath, remoteFile, patchFilePath))) {
            this.ui.logBox.add(`${chalk.red(remoteFile.name)} in sync`);
            return;
        }

        if (!this.isSafetyDownload) {
            this.statusEntries.syncCounter++;
        }
        this.lastFTPOperationTimestamp = dayjs();
        await fs.ensureDir(path.dirname(patchFilePath));

        this.ui.syncLogBox.add(chalk.yellow(`- ${remoteFile.name}`));

        this.trackDownloadProgress(remoteFile);
        await this.conn.safeDownload(fs.createWriteStream(patchFilePath), remoteFilePath);

        if (remoteFile.modifiedAt) {
            await fs.utimes(patchFilePath, new Date(), remoteFile.modifiedAt);
        }

        this.updateSyncLog(remoteFile);
        this.conn.trackProgress();
    }

    private trackDownloadProgress(remoteFile: FileInfo) {
        let lastBytesOverall = 0;
        const startTime = process.hrtime();

        this.conn.trackProgress(info => {
            const elapsedSeconds = this.getElapsedTimeInSeconds(startTime);
            const bytesSinceLast = info.bytesOverall - lastBytesOverall;
            const speed = bytesSinceLast / elapsedSeconds / 1024;

            lastBytesOverall = info.bytesOverall;
            this.statusEntries.downloadMsg = `Download: ${((info.bytesOverall / remoteFile.size) * 100).toFixed(
                2
            )}% @ ${speed.toFixed(2)} kB/s`;
            this.ui.updateStatusBox(this.statusEntries);
            this.ui.screen.render();
        });
    }

    private getElapsedTimeInSeconds(start: [number, number]): number {
        const [seconds, nanoseconds] = process.hrtime(start);
        return seconds + nanoseconds / 1e9;
    }

    private updateSyncLog(remoteFile: FileInfo) {
        const syncContent = this.ui.syncLogBox.content.split('\n');
        syncContent.pop();
        this.ui.syncLogBox.setContent(syncContent.join('\n'));
        if (this.isSafetyDownload) {
            this.ui.syncLogBox.add(chalk.bold.strikethrough.grey.dim(`\u2713 ${remoteFile.name} (safety)`));
            this.isSafetyDownload = false;
        } else {
            this.ui.syncLogBox.add(chalk.bold.green(`\u2713 ${remoteFile.name}`));
        }
    }

    private async syncFTPToLocal() {
        try {
            await this.conn.connect();
            this.isSyncRunning = true;
            await this.traverseAndSync(this.localDir, this.remoteDir, this.patchDir);
        } catch (error) {
            this.ui.logBox.log(`Error syncing FTP: ${error.message}`);
            throw error;
        } finally {
            this.conn.close();
        }
    }
}
