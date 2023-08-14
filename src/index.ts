import * as fs from 'fs-extra';
import { Client, FileInfo, FileType } from 'basic-ftp';
import * as path from 'path';
import dayjs from 'dayjs';
import { IFTPConfig, ISyncConfig } from './@types/interfaces';
import chalk from 'chalk';
import { setupUI } from './ui';

const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'configs', process.argv[2])).toString()
) as ISyncConfig;
const { localDir, remoteDir, patchDir } = config;

const {
    screen,
    logBox,
    syncLogBox,
    statusBox,
    currentDirectoryBox } = setupUI(config);

let isSyncRunning = false;
let fileCounter = 0;
let syncCounter = 0;

let lastFTPOperationTimestamp = dayjs();

screen.key(['q', 'C-c'], function () {
    return process.exit(0);
});

// Start the FTP sync when the 's' key is pressed
screen.key(['s'], async function () {
    try {
        await syncFTPToLocal(config.ftpConfig);
    } catch (error) {
        logBox.log(`Error: ${error.message}`);
        screen.render();
    }
});

screen.key(['x'], async function () {
    if (isSyncRunning) {
        logBox.add(`processing stopped...`);
        isSyncRunning = false;
    }
});

screen.key(['c'], async function () {
    if (!isSyncRunning) {
        logBox.add(`processing continues...`);
        isSyncRunning = true;
    }
});

function ftpPath(...segments: string[]): string {
    return path.posix.join(...segments);
}

async function shouldDownloadFile(
    localFilePath: string,
    remoteFile: FileInfo,
    patchFilePath: string
): Promise<boolean> {
    fileCounter++;
    if (await fs.pathExists(localFilePath)) {
        const localFileStats = await fs.stat(localFilePath);
        return localFileStats.size !== remoteFile.size;
    }

    if (await fs.pathExists(patchFilePath)) {
        const patchFileStats = await fs.stat(patchFilePath);
        return (
            patchFileStats.size !== remoteFile.size || dayjs().subtract(1, 'minute').isAfter(lastFTPOperationTimestamp)
        );
    }

    return true;
}

async function waitForContinueFlag() {
    return new Promise(resolve => {
        const checkInterval = setInterval(() => {
            if (isSyncRunning) {
                clearInterval(checkInterval);
                resolve(null);
            }
        }, 100); // checking every 100ms
    });
}

async function traverseAndSync(client: Client, localPath: string, remotePath: string, patchBasePath: string) {
    const remoteFiles = await client.list(remotePath);
    for (const file of remoteFiles) {
        await waitForContinueFlag();

        if (file.name === '.' || file.name === '..') continue;
        statusBox.setItems([`files processed: ${fileCounter}`, `files synchronized: ${syncCounter}`, `Download: -`]);
        const localFilePath = path.join(localPath, file.name);
        const remoteFilePath = ftpPath(remotePath, file.name);
        const relativePathFromStart = path.relative(localDir, localFilePath);
        const patchFilePath = path.join(patchBasePath, relativePathFromStart);

        if (file.type === FileType.Directory) {
            currentDirectoryBox.setText(`current remote directory: ${remoteFilePath}`);
            screen.render();
            await traverseAndSync(client, localFilePath, remoteFilePath, patchBasePath);
        } else {
            if (await shouldDownloadFile(localFilePath, file, patchFilePath)) {
                syncCounter++;
                lastFTPOperationTimestamp = dayjs();
                await fs.ensureDir(path.dirname(patchFilePath));

                syncLogBox.add(chalk.yellow(`- ${file.name}`));
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

                    statusBox.setItems([
                        `files processed: ${fileCounter}`,
                        `files synchronized: ${syncCounter}`,
                        `Download: ${((info.bytesOverall / file.size) * 100).toFixed(2)}% @ ${speed.toFixed(2)} kB/s`
                    ]);

                    screen.render();
                });

                await client.downloadTo(fs.createWriteStream(patchFilePath), remoteFilePath);
                const syncContent = syncLogBox.content.split('\n');
                syncContent.pop();
                syncLogBox.setContent(syncContent.join('\n'));
                syncLogBox.add(chalk.bold.green(`\u2713 ${file.name}`));
                client.trackProgress();
            } else {
                logBox.add(`${chalk.red(file.name)} already synced`);
            }
        }
        screen.render();
    }
}

async function syncFTPToLocal(ftpConfig: IFTPConfig) {
    logBox.log('Connecting to FTP server...');
    const client = new Client();
    client.ftp.encoding = 'latin1';
    try {
        await client.access(ftpConfig);
        await client.useDefaultSettings();
        logBox.log(`Connection to FTP established`);
        isSyncRunning = true;
        await traverseAndSync(client, localDir, remoteDir, patchDir);
    } catch (error) {
        logBox.log(`Error syncing FTP: ${error.message}`);
        throw error;
    } finally {
        client.close();
    }
}

(() => {
    screen.render();
})();
