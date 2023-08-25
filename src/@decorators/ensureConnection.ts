import { ConnectionManager } from '../ConnectionManager';

export function ensureConnection(_: unknown, __: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
        const manager = this as ConnectionManager;

        try {
            if (manager.getClient().closed) {
                await manager.safeReconnect();
            }
            return await originalMethod.apply(manager, args);
        } catch (err) {
            manager.getLogger()?.log(`connection lost - trying to reconnect`);
            await manager.safeReconnect();
            return await originalMethod.apply(manager, args);
        }
    };

    return descriptor;
}
