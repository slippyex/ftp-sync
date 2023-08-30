import { ConnectionManager } from '../src/ConnectionManager';
import { IFTPConfig } from '../src/@types/interfaces';

const mockAccess = jest.fn();
const mockList = jest.fn();
const mockUseDefaultSettings = jest.fn();

jest.mock('basic-ftp', () => {
    return {
        Client: jest.fn().mockImplementation(() => ({
            ftp: {
                encoding: 'utf8'
            },
            closed: true,
            access: mockAccess,
            list: mockList,
            useDefaultSettings: mockUseDefaultSettings
        }))
    };
});

let connectionManager: ConnectionManager;
const mockLogger = {
    log: jest.fn()
};

describe('ConnectionManager', () => {
    beforeEach(() => {
        mockAccess.mockClear();
        mockList.mockClear();
        mockUseDefaultSettings.mockClear();

        mockAccess.mockImplementation(async function () {
            this.closed = false;
        });
        mockList.mockResolvedValue([{ name: 'file1.txt' }, { name: 'file2.txt' }]);
        mockUseDefaultSettings.mockImplementation(() => {});

        connectionManager = new ConnectionManager(
            {
                defaultEncoding: 'latin1'
            } as IFTPConfig,
            mockLogger
        );
    });

    it('should connect to the FTP server', async () => {
        await connectionManager.connect();
        expect(mockLogger.log).toHaveBeenCalledWith('Connecting to FTP server...');
        expect(mockAccess).toHaveBeenCalled();
        expect(mockUseDefaultSettings).toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith('Connection to FTP established');
    });

    it('should list files from the FTP server', async () => {
        await connectionManager.connect();
        const mockFiles = [{ name: 'file1.txt' }, { name: 'file2.txt' }];
        mockList.mockResolvedValue(mockFiles);
        const files = await connectionManager.safeList('/path/to/dir');
        expect(files).toEqual(mockFiles);
    });

    it('should attempt to reconnect to the FTP server', async () => {
        mockAccess.mockRejectedValueOnce(new Error('Failed'));
        await connectionManager.safeReconnect(2, 1);
        expect(mockAccess).toHaveBeenCalledTimes(2);
    });

    it('should throw an error after max retries', async () => {
        mockAccess.mockRejectedValue(new Error('Failed'));
        await expect(connectionManager.safeReconnect(2, 1)).rejects.toThrow(
            'Failed to connect after multiple attempts'
        );
    });
});
