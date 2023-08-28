import { Widgets } from 'blessed';
import { IStatusEntries, ISyncConfig } from './@types/interfaces';
import {createAlertBox, setupUI} from './lib/ui';

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

    public updateStatusBox(options: IStatusEntries) {
        this.statusBox.setItems([
            `elapsed time: ${options.elapsedTime}`,
            `files processed: ${options.fileCounter} @ ${options.processingRate}`,
            `files synchronized: ${options.syncCounter}`,
            `Download: ${options.downloadMsg}`
        ]);
    }

    public createQuitConfirm() {
        const quitConfirm = createAlertBox(this.screen);

        // Keybindings for the confirmation
        this.screen.key(['y'], () => {
            // Handle quitting the app
            process.exit(0);
        });

        this.screen.key(['n'], () => {
            quitConfirm.detach();
            this.screen.render();
        });

        this.screen.append(quitConfirm);
        this.screen.render();
    }
}
