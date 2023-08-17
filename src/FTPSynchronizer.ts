import * as fs from 'fs-extra';
import { Client, FileInfo, FileType } from 'basic-ftp';
import * as path from 'path';
import dayjs from 'dayjs';
import { IFTPConfig, ISyncConfig } from './@types/interfaces';
import chalk from 'chalk';
import { setupUI } from './ui';
import { Widgets } from 'blessed';

export class FtpSynchronizer {
    private readonly config: ISyncConfig;
    private readonly localDir: string;
    private readonly remoteDir: string;
    private readonly patchDir: string;
    private screen: Widgets.Screen;
    private logBox: Widgets.Log;
    private syncLogBox: Widgets.Log;
    private statusBox: Widgets.ListElement;
    private currentDirectoryBox: Widgets.BoxElement;
    private isSyncRunning = false;
    private fileCounter = 0;
    private syncCounter = 0;
    private lastFTPOperationTimestamp = dayjs();
    private syncStartTime: Date | null = null;
    private timerInterval: NodeJS.Timeout | null = null;
    private elapsedTime = '00:00:00';
    private downloadMsg = '-';
    private isSafetyDownload = false;

    constructor(configFileName: string) {
        this.config = this.getConfig(configFileName);
        this.localDir = this.config.localDir;
        this.remoteDir = this.config.remoteDir;
        this.patchDir = this.config.patchDir;

        const ui = setupUI(this.config);
        this.screen = ui.screen;
        this.logBox = ui.logBox;
        this.syncLogBox = ui.syncLogBox;
        this.statusBox = ui.statusBox;
        this.currentDirectoryBox = ui.currentDirectoryBox;

        this.initializeScreen();
    }

    private initializeScreen() {
        this.screen.key(['q', 'C-c'], () => process.exit(0));
        this.screen.key(['s', 'x'], this.handleKeyPress.bind(this));
        this.updateStatusBox();
        this.screen.render();
    }

    private startTimer() {
        this.timerInterval = setInterval(() => {
            this.elapsedTime = this.getElapsedTime();
            this.updateStatusBox();
        }, 1000); // Update every second
    }
    private handleKeyPress(_: never, key: { name: string }) {
        switch (key.name) {
            case 's':
                if (!this.isSyncRunning) {
                    this.syncStartTime = new Date();
                    this.startTimer();

                    this.syncFTPToLocal(this.config.ftpConfig).catch(error => {
                        this.logBox.log(`Error: ${error.message}`);
                        this.screen.render();
                    });
                }
                break;
            case 'x':
                if (this.isSyncRunning) {
                    this.logBox.add(`processing stopped...`);
                    clearInterval(this.timerInterval);
                    this.isSyncRunning = false;
                } else {
                    this.logBox.add(`processing continues...`);
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
        const rate = this.fileCounter / diffSeconds;
        return `${rate.toFixed(2)} files/s`;
    }

    private updateStatusBox() {
        const rate = this.getProcessingRate();
        this.statusBox.setItems([
            `elapsed time: ${this.elapsedTime}`,
            `files processed: ${this.fileCounter} @ ${rate}`,
            `files synchronized: ${this.syncCounter}`,
            `Download: ${this.downloadMsg}`
        ]);
    }

    private getElapsedTime(): string {
        if (!this.syncStartTime) return '00:00:00';

        const now = new Date();
        const diff = now.getTime() - this.syncStartTime.getTime(); // difference in milliseconds

        const hours = Math.floor(diff / (60 * 60 * 1000));
        const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((diff % (60 * 1000)) / 1000);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
            2,
            '0'
        )}`;
    }

    private async shouldDownloadFile(
        localFilePath: string,
        remoteFile: FileInfo,
        patchFilePath: string
    ): Promise<boolean> {
        this.fileCounter++;
        if (dayjs().subtract(1, 'minute').isAfter(this.lastFTPOperationTimestamp)) {
            this.logBox.log(`--- safety sync ---`);
            this.isSafetyDownload = true;
        }
        if (await fs.pathExists(localFilePath)) {
            const localFileStats = await fs.stat(localFilePath);
            return (
                localFileStats.size !== remoteFile.size ||
                dayjs().subtract(1, 'minute').isAfter(this.lastFTPOperationTimestamp)
            );
        }

        if (await fs.pathExists(patchFilePath)) {
            const patchFileStats = await fs.stat(patchFilePath);
            return (
                patchFileStats.size !== remoteFile.size ||
                dayjs().subtract(1, 'minute').isAfter(this.lastFTPOperationTimestamp)
            );
        }

        return true;
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
    private async safeReconnect(client: Client, maxRetries = 3) {
        let retries = 0;
        while (retries < maxRetries) {
            try {
                await client.access(this.config.ftpConfig);
                return; // if successful, just exit
            } catch (error) {
                retries++;
                if (retries >= maxRetries) {
                    throw new Error('Failed to connect after multiple attempts');
                }
                await this.sleep(2000); // wait for 2 seconds before retrying
            }
        }
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    private async safeList(client: Client, remotePath: string): Promise<FileInfo[]> {
        try {
            return client.list(remotePath);
        } catch (err) {
            this.logBox.log(`connection lost - trying to reconnect`);
            await this.safeReconnect(client);
            return client.list(remotePath);
        }
    }

    private async traverseAndSync(client: Client, localPath: string, remotePath: string, patchBasePath: string) {
        const remoteFiles = await this.safeList(client, remotePath);
        for (const remoteFile of remoteFiles) {
            await this.waitForContinueFlag();

            if (remoteFile.name === '.' || remoteFile.name === '..') continue;
            this.downloadMsg = '-';
            const localFilePath = path.join(localPath, remoteFile.name);
            const remoteFilePath = this.ftpPath(remotePath, remoteFile.name);
            const relativePathFromStart = path.relative(this.localDir, localFilePath);
            const patchFilePath = path.join(patchBasePath, relativePathFromStart);

            if (remoteFile.type === FileType.Directory) {
                this.currentDirectoryBox.setText(`current remote directory: ${remoteFilePath}`);
                this.screen.render();
                await this.traverseAndSync(client, localFilePath, remoteFilePath, patchBasePath);
            } else {
                if (await this.shouldDownloadFile(localFilePath, remoteFile, patchFilePath)) {
                    if (!this.isSafetyDownload) {
                        this.syncCounter++;
                    }
                    this.lastFTPOperationTimestamp = dayjs();
                    await fs.ensureDir(path.dirname(patchFilePath));

                    this.syncLogBox.add(chalk.yellow(`- ${remoteFile.name}`));
                    const getElapsedTimeInSeconds = (start: [number, number]): number => {
                        const [seconds, nanoseconds] = process.hrtime(start);
                        return seconds + nanoseconds / 1e9;
                    };

                    let lastBytesOverall = 0;
                    const startTime = process.hrtime(); // Start the timer here

                    client.trackProgress(info => {
                        const elapsedSeconds = getElapsedTimeInSeconds(startTime);
                        const bytesSinceLast = info.bytesOverall - lastBytesOverall;

                        // Speed since the last check
                        const speed = bytesSinceLast / elapsedSeconds / 1024;

                        lastBytesOverall = info.bytesOverall;
                        this.downloadMsg = `Download: ${((info.bytesOverall / remoteFile.size) * 100).toFixed(
                            2
                        )}% @ ${speed.toFixed(2)} kB/s`;
                        this.updateStatusBox();

                        this.screen.render();
                    });

                    await client.downloadTo(fs.createWriteStream(patchFilePath), remoteFilePath);
                    // Set the modification time of the local file to match the remote file
                    if (remoteFile.modifiedAt) {
                        await fs.utimes(patchFilePath, new Date(), remoteFile.modifiedAt);
                    }

                    const syncContent = this.syncLogBox.content.split('\n');
                    syncContent.pop();
                    this.syncLogBox.setContent(syncContent.join('\n'));
                    if (this.isSafetyDownload) {
                        this.syncLogBox.add(chalk.bold.strikethrough.grey.dim(`\u2713 ${remoteFile.name} (safety)`));
                        this.isSafetyDownload = false;
                    } else {
                        this.syncLogBox.add(chalk.bold.green(`\u2713 ${remoteFile.name}`));
                    }
                    client.trackProgress();
                } else {
                    this.logBox.add(`${chalk.red(remoteFile.name)} in sync`);
                }
            }
            this.screen.render();
        }
    }

    private async syncFTPToLocal(ftpConfig: IFTPConfig) {
        this.logBox.log('Connecting to FTP server...');
        const client = new Client();
        client.ftp.encoding = 'latin1';
        try {
            await client.access(ftpConfig);
            await client.useDefaultSettings();
            this.logBox.log(`Connection to FTP established`);
            this.isSyncRunning = true;
            await this.traverseAndSync(client, this.localDir, this.remoteDir, this.patchDir);
        } catch (error) {
            this.logBox.log(`Error syncing FTP: ${error.message}`);
            throw error;
        } finally {
            client.close();
        }
    }
}
