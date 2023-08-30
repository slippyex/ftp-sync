/* eslint-disable @typescript-eslint/no-explicit-any */
// required due to the nature of the class under test and all its private member functions
import * as fs from 'fs-extra';
import { FtpSynchronizer } from '../src/FTPSynchronizer';
import { FileType } from 'basic-ftp';

// Mocking the dependencies
jest.mock('fs-extra', () => ({
    existsSync: jest.fn(),
    pathExists: jest.fn(),
    readFileSync: jest.fn(),
    ensureDir: jest.fn(),
    createWriteStream: jest.fn(),
    utimes: jest.fn(),
    stat: jest.fn<Promise<fs.Stats>, [fs.PathLike]>()
}));
jest.mock('../src/FTPUserInterface', () => {
    return {
        FTPUserInterface: jest.fn().mockImplementation(() => {
            return {
                screen: {
                    key: jest.fn(),
                    render: jest.fn()
                },
                currentDirectoryBox: {
                    setText: jest.fn()
                },
                syncLogBox: {
                    add: jest.fn(),
                    setContent: jest.fn(),
                    content: ''
                },
                logBox: {
                    add: jest.fn()
                },
                createQuitConfirm: jest.fn()
            };
        })
    };
});

jest.mock('../src/ConnectionManager', () => {
    return {
        ConnectionManager: jest.fn().mockImplementation(() => {
            return {
                connect: jest.fn(),
                safeList: jest.fn(),
                safeDownload: jest.fn(),
                close: jest.fn(),
                isClosed: false,
                trackProgress: jest.fn()
            };
        })
    };
});

describe('FtpSynchronizer', () => {
    let ftpSync: FtpSynchronizer;

    beforeEach(() => {
        const mockConfigFileName = 'testConfig.json';
        const mockConfig = {
            localDir: 'local',
            remoteDir: 'remote',
            patchDir: 'patch',
            ftpConfig: {}
        };
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
        ftpSync = new FtpSynchronizer(mockConfigFileName);
        jest.spyOn(ftpSync as any, 'waitForContinueFlag').mockResolvedValue(undefined);
    });

    it('should initialize properties correctly in constructor', () => {
        const mockConfigFileName = 'testConfig.json';
        const mockConfig = {
            localDir: 'local',
            remoteDir: 'remote',
            patchDir: 'patch',
            ftpConfig: {}
        };
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));

        ftpSync = new FtpSynchronizer(mockConfigFileName);

        expect(ftpSync).toBeDefined();
    });

    it('should get config correctly', () => {
        const mockConfigFileName = 'testConfig.json';
        const mockConfig = {
            localDir: 'local',
            remoteDir: 'remote',
            patchDir: 'patch',
            ftpConfig: {}
        };
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));

        ftpSync = new FtpSynchronizer(mockConfigFileName);
        const config = (ftpSync as any).getConfig(mockConfigFileName);

        expect(config).toEqual(mockConfig);
    });

    it('should traverse directories correctly', async () => {
        (ftpSync['conn'].safeList as jest.Mock).mockImplementation((remotePath: string) => {
            if (remotePath === 'remotePath') {
                return Promise.resolve([
                    { name: '.', type: FileType.Directory },
                    { name: '..', type: FileType.Directory },
                    { name: 'dir1', type: FileType.Directory }
                ]);
            } else if (remotePath === 'remotePath/dir1') {
                return Promise.resolve([{ name: 'file1.txt', type: FileType.File }]);
            } else {
                return Promise.resolve([]); // Empty array for other directories
            }
        });
        await ftpSync['traverseAndSync']('localPath', 'remotePath', 'patchBasePath');
        expect(ftpSync['ui'].currentDirectoryBox.setText).toHaveBeenCalledWith(
            'current remote directory: remotePath/dir1'
        );
    });

    it('should skip . and .. directories', async () => {
        const mockRemoteFiles = [
            { name: '.', type: FileType.Directory },
            { name: '..', type: FileType.Directory }
        ];
        jest.spyOn(ftpSync as any, 'waitForContinueFlag').mockResolvedValue(undefined);
        (ftpSync['conn'].safeList as jest.Mock).mockResolvedValue(mockRemoteFiles);

        await ftpSync['traverseAndSync']('localPath', 'remotePath', 'patchBasePath');

        expect(ftpSync['ui'].currentDirectoryBox.setText).not.toHaveBeenCalled();
    });

    it('should download files when necessary', async () => {
        const mockRemoteFile = { name: 'file1.txt', type: FileType.File, size: 100, modifiedAt: new Date() };
        const mockRemoteFiles = [mockRemoteFile];

        jest.spyOn(ftpSync as any, 'waitForContinueFlag').mockResolvedValue(undefined);
        (ftpSync['conn'].safeList as jest.Mock).mockResolvedValue(mockRemoteFiles);

        (fs.pathExists as jest.Mock).mockResolvedValue(false); // Indicate that local file doesn't exist

        await ftpSync['traverseAndSync']('localPath', 'remotePath', 'patchBasePath');

        expect(ftpSync['conn'].safeDownload).toHaveBeenCalled();
    });

    it('should skip files that are in sync', async () => {
        const mockRemoteFile = { name: 'file1.txt', type: FileType.File, size: 100, modifiedAt: new Date() };
        const mockRemoteFiles = [mockRemoteFile];

        (ftpSync['conn'].safeList as jest.Mock).mockResolvedValue(mockRemoteFiles);
        (fs.pathExists as jest.Mock).mockResolvedValue(true); // Indicate that local file exists

        const mockedStats: Partial<fs.Stats> = {
            size: 100
        };

        (fs.stat as jest.MockedFunction<typeof fs.stat>).mockImplementation(() =>
            Promise.resolve(mockedStats as fs.Stats)
        );

        await ftpSync['traverseAndSync']('localPath', 'remotePath', 'patchBasePath');

        expect(ftpSync['conn'].safeDownload).not.toHaveBeenCalled();
        expect(ftpSync['ui'].logBox.add).toHaveBeenCalledWith(expect.stringContaining('in sync'));
    });
});
