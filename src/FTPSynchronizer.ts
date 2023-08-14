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
        this.screen.render();
    }

    private handleKeyPress(_: never, key: { name: string }) {
        switch (key.name) {
            case 's':
                if (!this.isSyncRunning) {
                    this.syncFTPToLocal(this.config.ftpConfig).catch(error => {
                        this.logBox.log(`Error: ${error.message}`);
                        this.screen.render();
                    });
                }
                break;
            case 'x':
                if (this.isSyncRunning) {
                    this.logBox.add(`processing stopped...`);
                    this.isSyncRunning = false;
                } else {
                    this.logBox.add(`processing continues...`);
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

    private updateStatusBox(downloadMsg: string) {
        this.statusBox.setItems([
            `files processed: ${this.fileCounter}`,
            `files synchronized: ${this.syncCounter}`,
            `Download: ${downloadMsg}`
        ]);
    }

    private async shouldDownloadFile(
        localFilePath: string,
        remoteFile: FileInfo,
        patchFilePath: string
    ): Promise<boolean> {
        this.fileCounter++;
        if (await fs.pathExists(localFilePath)) {
            const localFileStats = await fs.stat(localFilePath);
            return localFileStats.size !== remoteFile.size;
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

    private async traverseAndSync(client: Client, localPath: string, remotePath: string, patchBasePath: string) {
        const remoteFiles = await client.list(remotePath);
        for (const file of remoteFiles) {
            await this.waitForContinueFlag();

            if (file.name === '.' || file.name === '..') continue;
            this.updateStatusBox('-');
            const localFilePath = path.join(localPath, file.name);
            const remoteFilePath = this.ftpPath(remotePath, file.name);
            const relativePathFromStart = path.relative(this.localDir, localFilePath);
            const patchFilePath = path.join(patchBasePath, relativePathFromStart);

            if (file.type === FileType.Directory) {
                this.currentDirectoryBox.setText(`current remote directory: ${remoteFilePath}`);
                this.screen.render();
                await this.traverseAndSync(client, localFilePath, remoteFilePath, patchBasePath);
            } else {
                if (await this.shouldDownloadFile(localFilePath, file, patchFilePath)) {
                    this.syncCounter++;
                    this.lastFTPOperationTimestamp = dayjs();
                    await fs.ensureDir(path.dirname(patchFilePath));

                    this.syncLogBox.add(chalk.yellow(`- ${file.name}`));
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
                        this.updateStatusBox(
                            `Download: ${((info.bytesOverall / file.size) * 100).toFixed(2)}% @ ${speed.toFixed(
                                2
                            )} kB/s`
                        );

                        this.screen.render();
                    });

                    await client.downloadTo(fs.createWriteStream(patchFilePath), remoteFilePath);
                    const syncContent = this.syncLogBox.content.split('\n');
                    syncContent.pop();
                    this.syncLogBox.setContent(syncContent.join('\n'));
                    this.syncLogBox.add(chalk.bold.green(`\u2713 ${file.name}`));
                    client.trackProgress();
                } else {
                    this.logBox.add(`${chalk.red(file.name)} in sync`);
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
