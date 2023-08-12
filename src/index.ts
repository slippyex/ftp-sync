import * as fs from 'fs-extra';
import { Client, FileInfo, FileType } from 'basic-ftp';
import * as path from 'path';
import ora from 'ora';
import dayjs from 'dayjs';
import { IFTPConfig } from './@types/interfaces';
import config from '../config.marcer.json';

const { localDir, remoteDir, patchDir } = config;

function ftpPath(...segments: string[]): string {
    return path.posix.join(...segments);
}

let lastFTPOperationTimestamp = dayjs();

async function shouldDownloadFile(
    localFilePath: string,
    remoteFile: FileInfo,
    patchFilePath: string
): Promise<boolean> {
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

async function traverseAndSync(client: Client, localPath: string, remotePath: string, patchBasePath: string) {
    const remoteFiles = await client.list(remotePath);
    for (const file of remoteFiles) {
        if (file.name === '.' || file.name === '..') continue;

        const localFilePath = path.join(localPath, file.name);
        const remoteFilePath = ftpPath(remotePath, file.name);
        const relativePathFromStart = path.relative(localDir, localFilePath);
        const patchFilePath = path.join(patchBasePath, relativePathFromStart);

        if (file.type === FileType.Directory) {
            await traverseAndSync(client, localFilePath, remoteFilePath, patchBasePath);
        } else {
            if (await shouldDownloadFile(localFilePath, file, patchFilePath)) {
                lastFTPOperationTimestamp = dayjs();
                await fs.ensureDir(path.dirname(patchFilePath));

                const spinner = ora({ text: `Downloading ${file.name}...`, spinner: 'dots' }).start();

                const getElapsedTimeInSeconds = (start: [number, number]): number => {
                    const [seconds, nanoseconds] = process.hrtime(start);
                    return seconds + nanoseconds / 1e9;
                };

                let lastBytesOverall = 0;
                client.trackProgress(info => {
                    const elapsedSeconds = getElapsedTimeInSeconds(process.hrtime());
                    const speed = (info.bytesOverall - lastBytesOverall) / elapsedSeconds / 1024;
                    spinner.text = `Downloading ${file.name}... ${((info.bytesOverall / file.size) * 100).toFixed(
                        2
                    )}% @ ${speed.toFixed(2)} kB/s`;
                    lastBytesOverall = info.bytesOverall;
                });

                await client.downloadTo(fs.createWriteStream(patchFilePath), remoteFilePath);
                client.trackProgress();
                spinner.succeed(`Downloaded ${file.name}`);
            }
        }
    }
}

async function syncFTPToLocal(ftpConfig: IFTPConfig) {
    const spinner = ora('Connecting to FTP...').start();
    const client = new Client();
    client.ftp.encoding = 'latin1';
    try {
        await client.access(ftpConfig);
        await client.useDefaultSettings();
        spinner.succeed('Connected to FTP');
        await traverseAndSync(client, localDir, remoteDir, patchDir);
    } catch (error) {
        spinner.fail(`Error syncing FTP: ${error.message}`);
        throw error;
    } finally {
        ora('Closing FTP connection...').start().succeed();
        client.close();
    }
}

(async () => {
    try {
        await syncFTPToLocal(config.ftpConfig);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
})();
