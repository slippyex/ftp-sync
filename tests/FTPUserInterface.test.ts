import { Widgets } from 'blessed';
import { FTPUserInterface } from '../src/FTPUserInterface';
import { createAlertBox, setupUI } from '../src/lib/ui';
import { ISyncConfig } from 'interfaces';

jest.mock('blessed');
jest.mock('../src/lib/ui');

describe('FTPUserInterface', () => {
    let ftpUI: FTPUserInterface;
    const mockConfig = {} as ISyncConfig;

    beforeEach(() => {
        (setupUI as jest.Mock).mockClear();
        (createAlertBox as jest.Mock).mockClear();
        (setupUI as jest.Mock).mockReturnValue({
            screen: {} as Widgets.Screen,
            logBox: {} as Widgets.Log,
            syncLogBox: {} as Widgets.Log,
            statusBox: {
                setItems: jest.fn()
            } as unknown as Widgets.ListElement,
            currentDirectoryBox: {} as Widgets.BoxElement
        });

        ftpUI = new FTPUserInterface(mockConfig);
    });

    it('should initialize with the correct UI elements', () => {
        expect(ftpUI.screen).toBeDefined();
        expect(ftpUI.logBox).toBeDefined();
        expect(ftpUI.syncLogBox).toBeDefined();
        expect(ftpUI.statusBox).toBeDefined();
        expect(ftpUI.currentDirectoryBox).toBeDefined();
    });

    it('should update the status box with correct values', () => {
        const mockOptions = {
            elapsedTime: '10s',
            fileCounter: 5,
            processingRate: '5/s',
            syncCounter: 3,
            downloadMsg: 'Downloading...'
        };

        ftpUI.updateStatusBox(mockOptions);

        expect(ftpUI.statusBox.setItems).toHaveBeenCalledWith([
            `elapsed time: ${mockOptions.elapsedTime}`,
            `files processed: ${mockOptions.fileCounter} @ ${mockOptions.processingRate}`,
            `files synchronized: ${mockOptions.syncCounter}`,
            `Download: ${mockOptions.downloadMsg}`
        ]);
    });
});
