import blessed, { Widgets } from 'blessed';
import { ISyncConfig } from '../@types/interfaces';

export function createAlertBox(screen: Widgets.Screen) {
    return blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 'shrink',
        border: { type: 'line' },
        label: 'Confirm',
        content: 'Are you sure to quit?\n\n[y] Yes  [n] No',
        align: 'center'
    });
}

export function setupUI(config: ISyncConfig) {
    const screen = blessed.screen({
        smartCSR: true,
        title: 'FTP Sync Dashboard - press S to start'
    });

    const ftpDetails = blessed.box({
        top: 0,
        left: 0,
        width: '33%',
        height: '20%',
        border: { type: 'line' },
        label: 'FTP Details'
    });
    ftpDetails.setContent(
        `Host: ${config.ftpConfig.host}\nUser: ${config.ftpConfig.user || 'anonymous'}\nPass: ********\nPort: ${
            config.ftpConfig.port || '21'
        }`
    );

    const pathSettings = blessed.list({
        top: 0,
        left: '33%',
        width: '34%',
        height: '20%',
        border: { type: 'line' },
        label: 'Path Settings',
        items: [
            `USB directory: ${config.localDir}`,
            `Patch Directory: ${config.patchDir}`,
            `FTP path: ${config.remoteDir}`
        ],
        keys: true,
        interactive: false
    });

    const statusBox = blessed.list({
        top: 0,
        left: '67%',
        width: '33%',
        height: '20%',
        border: { type: 'line' },
        label: 'Status'
    });

    const currentDirectoryBox = blessed.box({
        top: '20%',
        left: 0,
        width: '100%',
        height: '20%',
        border: { type: 'line' },
        label: 'Sync Progress'
    });

    const logBox = blessed.log({
        top: '40%',
        left: 0,
        width: '70%',
        height: '60%',
        border: { type: 'line' },
        fg: 'green',
        keys: true,
        vi: true,
        alwaysScroll: true,
        mouse: true,
        scrollable: true,
        label: 'Processing Log'
    });

    const syncLogBox = blessed.log({
        top: '40%',
        left: '70%',
        width: '30%',
        height: '60%',
        border: { type: 'line' },
        label: 'Sync Log'
    });

    screen.append(ftpDetails);
    screen.append(pathSettings);
    screen.append(statusBox);
    screen.append(currentDirectoryBox);
    screen.append(logBox);
    screen.append(syncLogBox);
    return {
        screen,
        logBox,
        syncLogBox,
        currentDirectoryBox,
        statusBox
    };
}
