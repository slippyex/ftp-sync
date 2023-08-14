import { FtpSynchronizer } from './FTPSynchronizer';

if (process.argv.length < 3) {
    console.error(`provide a config file (located in /configs/)`);
    process.exit(0);
}
new FtpSynchronizer(process.argv[2]);
