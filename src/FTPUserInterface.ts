import { Widgets } from 'blessed';
import { IStatusEntries, ISyncConfig } from './@types/interfaces';
import { setupUI } from './lib/ui';

export class FTPUserInterface {
    screen: Widgets.Screen;
    logBox: Widgets.Log;
    syncLogBox: Widgets.Log;
    statusBox: Widgets.ListElement;
    currentDirectoryBox: Widgets.BoxElement;

    constructor(config: ISyncConfig) {
        const ui = setupUI(config);
        this.screen = ui.screen;
        this.logBox = ui.logBox;
        this.syncLogBox = ui.syncLogBox;
        this.statusBox = ui.statusBox;
        this.currentDirectoryBox = ui.currentDirectoryBox;
    }

    initializeScreen() {
        this.screen.key(['q', 'C-c'], () => process.exit(0));
        this.screen.render();
    }
    public updateStatusBox(options: IStatusEntries) {
        this.statusBox.setItems([
            `elapsed time: ${options.elapsedTime}`,
            `files processed: ${options.fileCounter} @ ${options.processingRate}`,
            `files synchronized: ${options.syncCounter}`,
            `Download: ${options.downloadMsg}`
        ]);
    }
}
