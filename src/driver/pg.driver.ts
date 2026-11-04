import {
    Pool,
    PoolClient
} from 'pg';
import {
    EntityConstructor,
    TableStructure
} from '../types/structure';
import {
    Repository
} from './repository';

export interface TransactionContext {
    client: PoolClient;
    getRepository<T extends Record<string, any>>(
        entity: EntityConstructor<T> | TableStructure<T>
    ): Repository<T>;
    query<R = any>(sql: string, values?: unknown[]): Promise<R[]>;
}

export class PgDatabase {
    constructor(
        public readonly pool: Pool
    ) { }

    async verifyConnection(): Promise<void> {
        const client =
            await this.pool.connect();

        try {
            await client.query(
                'SELECT 1'
            );
        } finally {
            client.release();
        }
    }

    async transaction<T>(
        handler: (
            client: PoolClient,
            tx: TransactionContext
        ) => Promise<T>
    ): Promise<T> {
        const client =
            await this.pool.connect();

        try {
            await client.query(
                'BEGIN'
            );

            const tx: TransactionContext = {
                client,
                getRepository: <E extends Record<string, any>>(
                    entity: EntityConstructor<E> | TableStructure<E>
                ) => new Repository<E>(entity, client),
                query: async <R = any>(sql: string, values?: unknown[]) => {
                    const res = await client.query(sql, values);
                    return res.rows as R[];
                }
            };

            const result =
                await handler(client, tx);

            await client.query(
                'COMMIT'
            );

            return result;
        } catch (error) {
            await client.query(
                'ROLLBACK'
            );

            throw error;
        } finally {
            client.release();
        }
    }
}
