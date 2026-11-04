import {
    Pool,
    PoolClient,
    QueryResultRow
} from 'pg';

import {
    Filter
} from '../types/filter';

import {
    FindOptions,
    PaginateOptions,
    PaginatedResult,
    BuiltQuery
} from '../types/query';

import {
    TableStructure,
    EntityConstructor
} from '../types/structure';

import {
    resolveEntityStructure
} from '../decorators';

import {
    SqlBuilder
} from '../builders/sqlBuilder';

import {
    getPool
} from '../pool';

export type QueryExecutor = Pool | PoolClient;

export class Repository<
    T extends Record<string, any>
> {
    protected readonly builder: SqlBuilder<T>;
    protected readonly structure: TableStructure<T>;
    protected readonly executor: QueryExecutor;

    constructor(
        structure: TableStructure<T> | EntityConstructor<T>,
        executor?: QueryExecutor
    ) {
        this.structure =
            resolveEntityStructure(
                structure
            );

        this.builder =
            new SqlBuilder(
                this.structure
            );

        this.executor = executor ?? getPool();
    }

    protected async execute<
        R extends Record<string, any> = T
    >(
        query: BuiltQuery,
        client?: PoolClient
    ): Promise<R[]> {
        const executor =
            client ?? this.executor;

        const result =
            await executor.query<R & QueryResultRow>(
                query.sql,
                query.values
            );

        return result.rows as R[];
    }

    /**
     * Retorna a lista pura de registros encontrados.
     */
    async find(
        options: FindOptions<T> = {},
        client?: PoolClient
    ): Promise<T[]> {
        const query =
            this.builder.select(options);

        return this.execute<T>(
            query,
            client
        );
    }

    /**
     * Retorna os registros paginados com contagem total e metadados de página.
     */
    async paginate(
        options: PaginateOptions<T> = {},
        client?: PoolClient
    ): Promise<PaginatedResult<T>> {
        const pageIndex = Math.max(
            options.page ?? options.pagination?.pageIndex ?? 1,
            1
        );

        const pageSize = Math.max(
            options.pageSize ?? options.pagination?.pageSize ?? 10,
            1
        );

        const itemsQuery =
            this.builder.select({
                ...options,
                pagination: {
                    pageIndex,
                    pageSize
                }
            });

        const countQuery =
            this.builder.count(
                options.filters
            );

        const [items, countResult] = await Promise.all([
            this.execute<T>(
                itemsQuery,
                client
            ),
            this.execute<{
                count: number;
            }>(
                countQuery,
                client
            )
        ]);

        const totalItems =
            Number(
                countResult[0]?.count ?? 0
            );

        return {
            items,
            pagination: {
                pageIndex,
                pageSize,
                totalItems,
                totalPages:
                    Math.ceil(
                        totalItems / pageSize
                    )
            }
        };
    }

    async findOne(
        options: FindOptions<T> = {},
        client?: PoolClient
    ): Promise<T | null> {
        const items =
            await this.find(
                {
                    ...options,
                    limit: 1
                },
                client
            );

        return items[0] ?? null;
    }

    async findById(
        id: unknown,
        client?: PoolClient
    ): Promise<T | null> {
        const primaryKey =
            this.structure.primaryKeys[0];

        if (!primaryKey) {
            throw new Error(
                `Table "${this.structure.name}" has no primary key`
            );
        }

        return this.findOne(
            {
                filters: {
                    [primaryKey]: id
                } as Filter<T>
            },
            client
        );
    }

    async insert(
        document: Partial<T>,
        client?: PoolClient
    ): Promise<T> {
        const query =
            this.builder.insert(
                document
            );

        const result =
            await this.execute<T>(
                query,
                client
            );

        if (!result.length) {
            throw new Error(
                `Could not insert into "${this.structure.name}"`
            );
        }

        return result[0];
    }

    async upsert(
        document: Partial<T>,
        options: {
            conflictTarget?: Array<keyof T | string>;
            updateFields?: Array<keyof T | string>;
        } = {},
        client?: PoolClient
    ): Promise<T | null> {
        const query =
            this.builder.upsert(
                document,
                options.conflictTarget,
                options.updateFields
            );

        const result =
            await this.execute<T>(
                query,
                client
            );

        return result[0] ?? null;
    }

    async update(
        filter: Filter<T>,
        document: Partial<T>,
        client?: PoolClient
    ): Promise<T[]> {
        const query =
            this.builder.update(
                filter,
                document
            );

        return this.execute<T>(
            query,
            client
        );
    }

    async delete(
        filter: Filter<T>,
        client?: PoolClient
    ): Promise<number> {
        const query =
            this.builder.delete(filter);

        const executor =
            client ?? this.executor;

        const result =
            await executor.query(
                query.sql,
                query.values
            );

        return result.rowCount ?? 0;
    }

    async deleteAndReturn(
        filter: Filter<T>,
        client?: PoolClient
    ): Promise<T[]> {
        const query =
            this.builder.deleteReturning(filter);

        return this.execute<T>(
            query,
            client
        );
    }

    async count(
        filter?: Filter<T>,
        client?: PoolClient
    ): Promise<number> {
        const query =
            this.builder.count(filter);

        const result =
            await this.execute<{
                count: number;
            }>(
                query,
                client
            );

        return Number(
            result[0]?.count ?? 0
        );
    }
}

export function getRepository<
    T extends Record<string, any>
>(
    entity: EntityConstructor<T> | TableStructure<T>,
    executor?: QueryExecutor
): Repository<T> {
    return new Repository(entity, executor);
}

// Compatibilidade com código legado
export { Repository as GenericRepository };
