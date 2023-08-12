import * as fs from 'fs-extra';
import { Client, FileType } from 'basic-ftp';
import * as path from 'path';
import ora from 'ora';
import { IFTPConfig } from './@types/interfaces';
import config from '../config.marcer.json';

const localDir = config.localDir;
const remoteDir = config.remoteDir;
const patchDir = config.patchDir;

function ftpPath(...segments: string[]): string {
    return path.posix.join(...segments);
}

let lastFTPOperationTimestamp = Date.now();
let isFTPOperationRunning = false;

function keepAlive(client: Client) {
    setInterval(async () => {
        const elapsedTime = Date.now() - lastFTPOperationTimestamp;
        if (!isFTPOperationRunning && elapsedTime >= 800 * 1000) { // If it's been 800 seconds since last operation
            try {
                await client.send("NOOP");
                lastFTPOperationTimestamp = Date.now(); // Update the timestamp after sending NOOP
            } catch (error) {
                console.error("Error sending NOOP command:", error);
            }
        }
    }, 100 * 1000); // Check every 100 seconds
}


async function traverseAndSync(client: Client, localPath: string, remotePath: string, patchBasePath: string) {
    isFTPOperationRunning = true;
    lastFTPOperationTimestamp = Date.now();

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
            let shouldDownload = false;

            if (await fs.pathExists(localFilePath)) {
                const localFileStats = await fs.stat(localFilePath);
                if (localFileStats.size !== file.size) {
                    console.log(`Size mismatch - Local: ${localFilePath} | Remote: ${remoteFilePath}`);
                    shouldDownload = true;
                }
            } else if (await fs.pathExists(patchFilePath)) { // Check if the patch file exists and matches the size of the remote file
                const patchFileStats = await fs.stat(patchFilePath);
                if (patchFileStats.size === file.size) {
                    console.log(`File exists in patch and matches remote - Skipping: ${patchFilePath}`);
                    shouldDownload = false;
                } else {
                    // If file size doesn't match, we can decide to download or use another strategy.
                    shouldDownload = true;
                }
            } else {
                console.log(`Missing locally - Remote: ${remoteFilePath}`);
                shouldDownload = true;
            }

            if (shouldDownload) {
                await fs.ensureDir(path.dirname(patchFilePath));

                const spinner = ora({
                    text: `Downloading ${file.name}...`,
                    spinner: 'dots'
                }).start();

                let startTime = process.hrtime();

                // Helper function to compute elapsed time in seconds using process.hrtime
                const getElapsedTimeInSeconds = (start: [number, number]): number => {
                    const [seconds, nanoseconds] = process.hrtime(start);
                    return seconds + nanoseconds / 1e9; // Convert nanoseconds to seconds and add
                };

                let lastBytesOverall = 0;

                // Attach progress listener
                client.trackProgress(info => {
                    const elapsedSeconds = getElapsedTimeInSeconds(startTime);
                    const speed = (info.bytesOverall - lastBytesOverall) / elapsedSeconds / 1024; // Speed in kB/s

                    spinner.text = `Downloading ${file.name}... ${((info.bytesOverall / file.size) * 100).toFixed(
                        2
                    )}% @ ${speed.toFixed(2)} kB/s`;

                    lastBytesOverall = info.bytesOverall;
                    startTime = process.hrtime(); // Reset start time for next iteration
                });

                await client.downloadTo(fs.createWriteStream(patchFilePath), remoteFilePath);

                client.trackProgress(); // Removes progress tracker

                spinner.succeed(`Downloaded ${file.name}`);
            }
        }
    }
    lastFTPOperationTimestamp = Date.now();
    isFTPOperationRunning = false;
}

async function syncFTPToLocal(ftpConfig: IFTPConfig) {
    const spinner = ora('Connecting to FTP...').start();
    const client = new Client();
    client.ftp.encoding = 'latin1';
    try {
        await client.access(ftpConfig);
        await client.useDefaultSettings();
        keepAlive(client); // Maintain the connection
        //        client.ftp.verbose = true;
        spinner.succeed('Connected to FTP');

        await traverseAndSync(client, localDir, remoteDir, patchDir);
    } catch (error) {
        spinner.fail(`Error syncing FTP: ${error.message}`);
        throw new Error(error);
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
        throw new Error(error);
    }
})();
