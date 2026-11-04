import { Filter } from '../types/filter';
import { TableStructure } from '../types/structure';
import { BuiltQuery } from '../types/query';

type ColumnResolver =
    (property: string) => string;

export class FilterBuilder<
    T extends Record<string, any>
> {
    private values: unknown[] = [];

    constructor(
        private readonly structure: TableStructure<T>,
        private readonly tableAlias?: string,
        private readonly columnResolver?: ColumnResolver
    ) { }

    build(filter?: Filter<T>): BuiltQuery {
        this.values = [];

        if (!filter) {
            return {
                sql: '',
                values: []
            };
        }

        const conditions = this.parse(filter);

        return {
            sql: conditions.length
                ? `WHERE ${conditions.join(' AND ')}`
                : '',

            values: this.values
        };
    }

    private parse(
        filter: Filter<T>
    ): string[] {
        const result: string[] = [];

        for (
            const [key, value]
            of Object.entries(filter)
        ) {
            if (key === '$or') {
                const filters =
                    value as Filter<T>[];

                if (!filters.length) {
                    continue;
                }

                const conditions =
                    filters.map(filter => {
                        const result =
                            this.parse(filter);

                        return `(${result.join(' AND ')})`;
                    });

                result.push(
                    `(${conditions.join(' OR ')})`
                );

                continue;
            }

            if (key === '$and') {
                const filters =
                    value as Filter<T>[];

                if (!filters.length) {
                    continue;
                }

                const conditions =
                    filters.map(filter => {
                        const result =
                            this.parse(filter);

                        return `(${result.join(' AND ')})`;
                    });

                result.push(
                    `(${conditions.join(' AND ')})`
                );

                continue;
            }

            result.push(
                this.parseField(
                    key as keyof T,
                    value
                )
            );
        }

        return result;
    }

    private parseField(
        key: keyof T,
        value: any
    ): string {
        const column =
            this.column(String(key));

        /*
         * {
         *   deletedAt: null
         * }
         */
        if (value === null) {
            return `${column} IS NULL`;
        }

        /*
         * {
         *   username: "cesar"
         * }
         */
        if (
            typeof value !== 'object' ||
            value instanceof Date ||
            Array.isArray(value)
        ) {
            return `${column} = ${this.addValue(value)}`;
        }

        /*
         * {
         *   age: {
         *      $gte: 18
         *   }
         * }
         */
        const operations =
            Object.entries(value);

        if (!operations.length) {
            throw new Error(
                `Empty filter operation for field "${String(key)}"`
            );
        }

        const conditions =
            operations.map(
                ([operation, operationValue]) =>
                    this.operation(
                        column,
                        operation,
                        operationValue
                    )
            );

        return conditions.length > 1
            ? `(${conditions.join(' AND ')})`
            : conditions[0];
    }

    private operation(
        column: string,
        operation: string,
        value: unknown
    ): string {
        switch (operation) {
            case '$eq':
                return value === null
                    ? `${column} IS NULL`
                    : `${column} = ${this.addValue(value)}`;

            case '$ne':
                return value === null
                    ? `${column} IS NOT NULL`
                    : `${column} <> ${this.addValue(value)}`;

            case '$gt':
                return `${column} > ${this.addValue(value)}`;

            case '$gte':
                return `${column} >= ${this.addValue(value)}`;

            case '$lt':
                return `${column} < ${this.addValue(value)}`;

            case '$lte':
                return `${column} <= ${this.addValue(value)}`;

            case '$between':
                if (!Array.isArray(value) || value.length !== 2) {
                    throw new Error('$between requires an array with 2 elements: [min, max]');
                }
                return `${column} BETWEEN ${this.addValue(value[0])} AND ${this.addValue(value[1])}`;

            case '$like':
                return `${column} LIKE ${this.addValue(value)}`;

            case '$ilike':
                return `${column} ILIKE ${this.addValue(value)}`;

            case '$tsquery':
                if (typeof value !== 'string') {
                    throw new Error(
                        '$tsquery requires a string value'
                    );
                }

                const normalizedQuery = value.trim();

                if (!normalizedQuery) {
                    return 'FALSE';
                }

                return `${column} @@ plainto_tsquery('portuguese', ${this.addValue(normalizedQuery)})`;

            case '$in':
                return this.inOperation(
                    column,
                    value,
                    false
                );

            case '$notIn':
                return this.inOperation(
                    column,
                    value,
                    true
                );

            case '$any':
                return `${column} @> ${this.addValue(value)}`;

            default:
                throw new Error(
                    `Unknown filter operation "${operation}"`
                );
        }
    }

    private inOperation(
        column: string,
        value: unknown,
        negate: boolean
    ): string {
        if (!Array.isArray(value)) {
            throw new Error(
                '$in/$notIn requires an array'
            );
        }

        if (!value.length) {
            return negate
                ? 'TRUE'
                : 'FALSE';
        }

        const params =
            value.map(value =>
                this.addValue(value)
            );

        return `${column} ${negate ? 'NOT IN' : 'IN'
            } (${params.join(', ')})`;
    }

    private addValue(
        value: unknown
    ): string {
        this.values.push(value);

        return `$${this.values.length}`;
    }

    private column(
        property: string
    ): string {
        if (this.columnResolver) {
            return this.columnResolver(property);
        }

        const field =
            this.structure.fields[property];

        if (!field) {
            throw new Error(
                `Unknown field "${String(property)}" on table "${this.structure.name}"`
            );
        }

        const table =
            this.tableAlias ??
            this.structure.name;

        return `"${table}"."${field.name}"`;
    }
}
