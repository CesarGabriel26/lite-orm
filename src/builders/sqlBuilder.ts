import {
    Fields,
    Filter,
    Sort
} from '../types/filter';

import {
    BuiltQuery,
    FindOptions
} from '../types/query';

import {
    FieldStructure,
    RelationStructure,
    TableStructure
} from '../types/structure';

import {
    resolveRelatedStructure
} from '../decorators';

import {
    FilterBuilder
} from './filterBuilder';

interface ResolvedRelation<
    T extends Record<string, any>
> {
    relation: RelationStructure<T>;
    table: TableStructure<any>;
    alias: string;
}

interface ColumnTarget<
    T extends Record<string, any>
> {
    column: string;
    field: FieldStructure;
    relation?: ResolvedRelation<T>;
}

export class SqlBuilder<
    T extends Record<string, any>
> {
    private readonly rootAlias = 'root';

    private joins =
        new Map<string, ResolvedRelation<T>>();

    private hasManySelection =
        false;

    private groupByFields =
        new Set<string>();

    constructor(
        private readonly structure: TableStructure<T>
    ) { }

    select(
        options: FindOptions<T> = {}
    ): BuiltQuery {
        this.reset();

        const filter =
            this.buildFilter(
                options.filters,
                true
            );

        const fields =
            this.buildFields(
                options.fields
            );

        const sort =
            this.buildSort(
                options.sort,
                true
            );

        const values: unknown[] = [
            ...filter.values
        ];

        const sql: string[] = [
            `SELECT ${fields}`,
            `FROM ${this.tableName(this.structure)} AS ${this.quoteIdentifier(this.rootAlias)}`,
            this.buildJoinSql(),
            filter.sql,
            this.buildGroupBy(),
            sort
        ];

        const limit =
            options.limit ??
            (options.pagination
                ? Math.max(options.pagination.pageSize, 1)
                : undefined);

        const offset =
            options.offset ??
            (options.pagination
                ? (Math.max(options.pagination.pageIndex, 1) - 1) * (options.pagination.pageSize || 10)
                : undefined);

        if (limit !== undefined) {
            values.push(limit);
            sql.push(`LIMIT $${values.length}`);
        }

        if (offset !== undefined) {
            values.push(offset);
            sql.push(`OFFSET $${values.length}`);
        }

        return {
            sql: sql
                .filter(Boolean)
                .join(' '),

            values
        };
    }

    count(
        filter?: Filter<T>
    ): BuiltQuery {
        this.reset();

        const where =
            this.buildFilter(
                filter,
                true
            );

        const countExpression =
            this.joins.size
                ? this.distinctCountExpression()
                : 'COUNT(*)::int';

        return {
            sql: [
                `SELECT ${countExpression} AS count`,
                `FROM ${this.tableName(this.structure)} AS ${this.quoteIdentifier(this.rootAlias)}`,
                this.buildJoinSql(),
                where.sql
            ]
                .filter(Boolean)
                .join(' '),

            values: where.values
        };
    }

    insert(
        document: Partial<T>
    ): BuiltQuery {
        const entries =
            Object.entries(document)
                .filter(([key]) => {
                    if (!this.hasField(
                        this.structure,
                        key
                    )) {
                        return false;
                    }

                    const field =
                        this.getField(
                            this.structure,
                            key
                        );

                    return !field.generated;
                });

        if (!entries.length) {
            throw new Error(
                'Cannot insert empty document'
            );
        }

        const columns: string[] = [];
        const values: unknown[] = [];
        const placeholders: string[] = [];

        for (
            const [key, value]
            of entries
        ) {
            const field =
                this.getField(
                    this.structure,
                    key
                );

            columns.push(
                this.quoteIdentifier(field.name)
            );

            values.push(value);

            placeholders.push(
                `$${values.length}`
            );
        }

        return {
            sql: `
                INSERT INTO ${this.tableName(this.structure)}
                (${columns.join(', ')})
                VALUES (${placeholders.join(', ')})
                RETURNING ${this.buildReturningFields()}
            `.replace(/\s+/g, ' ').trim(),

            values
        };
    }

    upsert(
        document: Partial<T>,
        conflictTarget?: Array<keyof T | string>,
        updateFields?: Array<keyof T | string>
    ): BuiltQuery {
        const entries =
            Object.entries(document)
                .filter(([key]) => {
                    if (!this.hasField(
                        this.structure,
                        key
                    )) {
                        return false;
                    }

                    const field =
                        this.getField(
                            this.structure,
                            key
                        );

                    return !field.generated;
                });

        if (!entries.length) {
            throw new Error(
                'Cannot upsert empty document'
            );
        }

        const columns: string[] = [];
        const values: unknown[] = [];
        const placeholders: string[] = [];

        for (
            const [key, value]
            of entries
        ) {
            const field =
                this.getField(
                    this.structure,
                    key
                );

            columns.push(
                this.quoteIdentifier(field.name)
            );

            values.push(value);

            placeholders.push(
                `$${values.length}`
            );
        }

        const targetKeys = (conflictTarget && conflictTarget.length)
            ? conflictTarget
            : this.structure.primaryKeys;

        if (!targetKeys.length) {
            throw new Error(
                `Cannot upsert without primary keys or conflictTarget for "${this.structure.name}"`
            );
        }

        const targetColumns = targetKeys.map(k => {
            const field = this.getField(this.structure, String(k));
            return this.quoteIdentifier(field.name);
        });

        const updatableKeys = (updateFields && updateFields.length)
            ? updateFields.map(String)
            : entries.map(([k]) => k).filter(k => !targetKeys.map(String).includes(k));

        let conflictAction = 'DO NOTHING';
        if (updatableKeys.length > 0) {
            const updateSets = updatableKeys.map(k => {
                const field = this.getField(this.structure, k);
                const col = this.quoteIdentifier(field.name);
                return `${col} = EXCLUDED.${col}`;
            });
            conflictAction = `DO UPDATE SET ${updateSets.join(', ')}`;
        }

        return {
            sql: `
                INSERT INTO ${this.tableName(this.structure)}
                (${columns.join(', ')})
                VALUES (${placeholders.join(', ')})
                ON CONFLICT (${targetColumns.join(', ')})
                ${conflictAction}
                RETURNING ${this.buildReturningFields()}
            `.replace(/\s+/g, ' ').trim(),

            values
        };
    }

    update(
        filter: Filter<T>,
        document: Partial<T>
    ): BuiltQuery {
        const entries =
            Object.entries(document)
                .filter(([key]) => {
                    if (!this.hasField(
                        this.structure,
                        key
                    )) {
                        return false;
                    }

                    if (this.structure
                        .primaryKeys
                        .map(String)
                        .includes(key)) {
                        return false;
                    }

                    const field =
                        this.getField(
                            this.structure,
                            key
                        );

                    return !field.generated;
                });

        if (!entries.length) {
            throw new Error(
                'No fields to update'
            );
        }

        const values: unknown[] = [];

        const sets =
            entries.map(
                ([key, value]) => {
                    const field =
                        this.getField(
                            this.structure,
                            key
                        );

                    values.push(value);

                    return `${this.quoteIdentifier(field.name)} = $${values.length}`;
                }
            );

        /*
         * O FilterBuilder gera parâmetros começando
         * em $1, então precisamos reajustá-los porque
         * já existem os parâmetros do SET.
         */
        const where =
            this.buildFilter(
                filter,
                false
            );

        const offset =
            values.length;

        const whereSql =
            this.shiftParameters(
                where.sql,
                offset
            );

        values.push(...where.values);

        if (!whereSql) {
            throw new Error(
                'UPDATE requires a filter'
            );
        }

        return {
            sql: `
                UPDATE ${this.tableName(this.structure)}
                SET ${sets.join(', ')}
                ${whereSql}
                RETURNING ${this.buildReturningFields()}
            `.replace(/\s+/g, ' ').trim(),

            values
        };
    }

    delete(
        filter: Filter<T>
    ): BuiltQuery {
        const where =
            this.buildFilter(
                filter,
                false
            );

        if (!where.sql) {
            throw new Error(
                'DELETE requires a filter'
            );
        }

        return {
            sql: `
                DELETE FROM ${this.tableName(this.structure)}
                ${where.sql}
            `.replace(/\s+/g, ' ').trim(),

            values: where.values
        };
    }

    deleteReturning(
        filter: Filter<T>
    ): BuiltQuery {
        const where =
            this.buildFilter(
                filter,
                false
            );

        if (!where.sql) {
            throw new Error(
                'DELETE requires a filter'
            );
        }

        return {
            sql: `
                DELETE FROM ${this.tableName(this.structure)}
                ${where.sql}
                RETURNING ${this.buildReturningFields()}
            `.replace(/\s+/g, ' ').trim(),

            values: where.values
        };
    }

    private reset(): void {
        this.joins =
            new Map<string, ResolvedRelation<T>>();

        this.hasManySelection =
            false;

        this.groupByFields =
            new Set<string>();
    }

    private buildFilter(
        filter: Filter<T> | undefined,
        allowRelations: boolean
    ): BuiltQuery {
        const builder =
            allowRelations
                ? new FilterBuilder(
                    this.structure,
                    this.rootAlias,
                    property =>
                        this.resolveColumn(
                            property,
                            true
                        ).column
                )
                : new FilterBuilder(
                    this.structure
                );

        return builder.build(filter);
    }

    private buildFields(
        fields?: Fields<T>
    ): string {
        const selections: string[] = [];

        for (const key of this.selectedRootFields(fields)) {
            const field =
                this.getField(
                    this.structure,
                    key
                );

            const column =
                `${this.quoteIdentifier(this.rootAlias)}.${this.quoteIdentifier(field.name)}`;

            selections.push(
                `${column} AS ${this.quoteIdentifier(key)}`
            );

            this.groupByFields.add(column);
        }

        for (
            const [property, selectedFields]
            of this.selectedRelations(fields)
        ) {
            selections.push(
                this.buildRelationField(
                    property,
                    selectedFields
                )
            );
        }

        if (!selections.length) {
            throw new Error(
                `No fields selected for "${this.structure.name}"`
            );
        }

        return selections.join(', ');
    }

    private selectedRootFields(
        fields?: Fields<T>
    ): string[] {
        let keys =
            Object.keys(
                this.structure.fields
            );

        if (fields?.$include) {
            keys =
                fields.$include
                    .map(String)
                    .filter(key =>
                        !key.includes('.') &&
                        this.hasField(
                            this.structure,
                            key
                        )
                    );
        }

        if (fields?.$exclude) {
            const exclude =
                new Set(
                    fields.$exclude
                        .map(String)
                        .filter(key =>
                            !key.includes('.')
                        )
                );

            keys =
                keys.filter(
                    key => !exclude.has(key)
                );
        }

        return keys;
    }

    private selectedRelations(
        fields?: Fields<T>
    ): Map<string, Set<string> | undefined> {
        const selections =
            new Map<string, Set<string> | undefined>();

        if (!fields?.$include) {
            return selections;
        }

        for (const item of fields.$include.map(String)) {
            const [
                relation,
                relationField
            ] = item.split('.');

            if (
                relationField &&
                this.hasRelation(relation)
            ) {
                const existing =
                    selections.get(relation) ??
                    new Set<string>();

                existing.add(relationField);

                selections.set(
                    relation,
                    existing
                );

                continue;
            }

            if (this.hasRelation(item)) {
                selections.set(
                    item,
                    undefined
                );
            }
        }

        for (const item of fields.$exclude?.map(String) ?? []) {
            const [
                relation,
                relationField
            ] = item.split('.');

            if (!this.hasRelation(relation)) {
                continue;
            }

            if (!relationField) {
                selections.delete(relation);
                continue;
            }

            const existing =
                selections.get(relation);

            if (existing) {
                existing.delete(relationField);
            }
        }

        return selections;
    }

    private buildRelationField(
        property: string,
        explicitFields: Set<string> | undefined
    ): string {
        const relation =
            this.resolveRelation(property);

        const fieldNames =
            this.relationFieldNames(
                relation,
                explicitFields
            );

        if (!fieldNames.length) {
            throw new Error(
                `No fields selected for relation "${property}"`
            );
        }

        const alias =
            this.quoteIdentifier(relation.alias);

        const pairs =
            fieldNames.flatMap(
                fieldName => {
                    const field =
                        this.getField(
                            relation.table,
                            fieldName
                        );

                    return [
                        this.quoteLiteral(fieldName),
                        `${alias}.${this.quoteIdentifier(field.name)}`
                    ];
                }
            );

        const firstField =
            this.getField(
                relation.table,
                fieldNames[0]
            );

        const firstColumn =
            `${alias}.${this.quoteIdentifier(firstField.name)}`;

        if (relation.relation.type === 'manyToOne' || relation.relation.type === 'oneToOne') {
            for (const fieldName of fieldNames) {
                const field =
                    this.getField(
                        relation.table,
                        fieldName
                    );

                this.groupByFields.add(
                    `${alias}.${this.quoteIdentifier(field.name)}`
                );
            }

            return [
                'CASE',
                `WHEN ${firstColumn} IS NULL THEN NULL`,
                `ELSE jsonb_build_object(${pairs.join(', ')})`,
                'END',
                `AS ${this.quoteIdentifier(property)}`
            ].join(' ');
        }

        this.hasManySelection =
            true;

        return [
            'COALESCE(',
            `jsonb_agg(jsonb_build_object(${pairs.join(', ')})${this.relationSort(relation)})`,
            `FILTER (WHERE ${firstColumn} IS NOT NULL),`,
            `'[]'::jsonb`,
            `) AS ${this.quoteIdentifier(property)}`
        ].join(' ');
    }

    private relationFieldNames(
        relation: ResolvedRelation<T>,
        explicitFields: Set<string> | undefined
    ): string[] {
        let fields =
            explicitFields
                ? [...explicitFields]
                : Object.keys(
                    relation.table.fields
                );

        if (relation.relation.fields?.$include) {
            const include =
                new Set(
                    relation.relation.fields.$include.map(String)
                );

            fields =
                fields.filter(
                    field => include.has(field)
                );
        }

        if (relation.relation.fields?.$exclude) {
            const exclude =
                new Set(
                    relation.relation.fields.$exclude.map(String)
                );

            fields =
                fields.filter(
                    field => !exclude.has(field)
                );
        }

        return fields;
    }

    private buildSort(
        sort: Sort<T> | undefined,
        allowRelations: boolean
    ): string {
        if (!sort) {
            return '';
        }

        const entries =
            Object.entries(sort);

        if (!entries.length) {
            return '';
        }

        const result =
            entries.map(
                ([key, direction]) => {
                    const target =
                        this.resolveColumn(
                            key,
                            allowRelations
                        );

                    if (
                        !target.relation ||
                        target.relation.relation.type !== 'oneToMany'
                    ) {
                        this.groupByFields.add(
                            target.column
                        );
                    }

                    return `${target.column} ${direction === 'desc'
                        ? 'DESC'
                        : 'ASC'
                        }`;
                }
            );

        return `ORDER BY ${result.join(', ')}`;
    }

    private buildJoinSql(): string {
        return [...this.joins.values()]
            .map(relation => {
                const localField =
                    this.getField(
                        this.structure,
                        String(relation.relation.localField)
                    );

                const foreignField =
                    this.getField(
                        relation.table,
                        String(relation.relation.foreignField)
                    );

                const alias =
                    this.quoteIdentifier(relation.alias);

                return [
                    'LEFT JOIN',
                    `${this.tableName(relation.table)} AS ${alias}`,
                    'ON',
                    `${alias}.${this.quoteIdentifier(foreignField.name)}`,
                    '=',
                    `${this.quoteIdentifier(this.rootAlias)}.${this.quoteIdentifier(localField.name)}`
                ].join(' ');
            })
            .join(' ');
    }

    private buildGroupBy(): string {
        if (!this.hasManySelection) {
            return '';
        }

        if (!this.groupByFields.size) {
            for (const key of this.structure.primaryKeys.map(String)) {
                const field =
                    this.getField(
                        this.structure,
                        key
                    );

                this.groupByFields.add(
                    `${this.quoteIdentifier(this.rootAlias)}.${this.quoteIdentifier(field.name)}`
                );
            }
        }

        return this.groupByFields.size
            ? `GROUP BY ${[...this.groupByFields].join(', ')}`
            : '';
    }

    private buildReturningFields(): string {
        return Object.entries(
            this.structure.fields
        )
            .map(([key, field]) =>
                `${this.quoteIdentifier(field.name)} AS ${this.quoteIdentifier(key)}`
            )
            .join(', ');
    }

    private resolveColumn(
        property: string,
        allowRelations: boolean
    ): ColumnTarget<T> {
        const parts =
            property.split('.');

        if (parts.length > 1) {
            if (!allowRelations) {
                throw new Error(
                    `Relations are not supported in this query: "${property}"`
                );
            }

            const [
                relationName,
                fieldName
            ] = parts;

            const relation =
                this.resolveRelation(relationName);

            const field =
                this.getField(
                    relation.table,
                    fieldName
                );

            return {
                relation,
                field,
                column: `${this.quoteIdentifier(relation.alias)}.${this.quoteIdentifier(field.name)}`
            };
        }

        if (this.hasRelation(property)) {
            throw new Error(
                `Relation "${property}" requires a field path like "${property}.id"`
            );
        }

        const field =
            this.getField(
                this.structure,
                property
            );

        return {
            field,
            column: `${this.quoteIdentifier(this.rootAlias)}.${this.quoteIdentifier(field.name)}`
        };
    }

    private resolveRelation(
        property: string
    ): ResolvedRelation<T> {
        const existing =
            this.joins.get(property);

        if (existing) {
            return existing;
        }

        const relation =
            this.structure.relations?.[property];

        if (!relation) {
            throw new Error(
                `Unknown relation "${property}" on "${this.structure.name}"`
            );
        }

        const resolved: ResolvedRelation<T> = {
            relation,
            table:
                resolveRelatedStructure(
                    relation.entity
                ),
            alias:
                relation.alias ??
                property
        };

        this.joins.set(
            property,
            resolved
        );

        return resolved;
    }

    private relationSort(
        relation: ResolvedRelation<T>
    ): string {
        const sort =
            relation.relation.sort;

        if (!sort) {
            return '';
        }

        const items =
            Object.entries(sort)
                .map(([key, direction]) => {
                    const field =
                        this.getField(
                            relation.table,
                            key
                        );

                    return `${this.quoteIdentifier(relation.alias)}.${this.quoteIdentifier(field.name)} ${direction === 'desc'
                        ? 'DESC'
                        : 'ASC'
                        }`;
                });

        return items.length
            ? ` ORDER BY ${items.join(', ')}`
            : '';
    }

    private distinctCountExpression(): string {
        const keys =
            this.structure.primaryKeys.length
                ? this.structure.primaryKeys.map(String)
                : Object.keys(this.structure.fields).slice(0, 1);

        if (!keys.length) {
            return 'COUNT(*)::int';
        }

        const columns =
            keys.map(key => {
                const field =
                    this.getField(
                        this.structure,
                        key
                    );

                return `${this.quoteIdentifier(this.rootAlias)}.${this.quoteIdentifier(field.name)}`;
            });

        const expression =
            columns.length === 1
                ? columns[0]
                : `(${columns.join(', ')})`;

        return `COUNT(DISTINCT ${expression})::int`;
    }

    private hasRelation(
        key: string
    ): boolean {
        return Object.prototype
            .hasOwnProperty.call(
                this.structure.relations ?? {},
                key
            );
    }

    private hasField(
        table: TableStructure<any>,
        key: string
    ): boolean {
        return Object.prototype
            .hasOwnProperty.call(
                table.fields,
                key
            );
    }

    private getField(
        table: TableStructure<any>,
        key: string
    ): FieldStructure {
        const field =
            table.fields[key];

        if (!field) {
            throw new Error(
                `Unknown field "${key}" on "${table.name}"`
            );
        }

        return field;
    }

    private tableName(
        table: TableStructure<any>
    ): string {
        return table.name
            .split('.')
            .map(part =>
                this.quoteIdentifier(part)
            )
            .join('.');
    }

    private quoteIdentifier(
        identifier: string
    ): string {
        if (!identifier || identifier.includes('\0')) {
            throw new Error(
                `Invalid SQL identifier "${identifier}"`
            );
        }

        return `"${identifier.replace(/"/g, '""')}"`;
    }

    private quoteLiteral(
        value: string
    ): string {
        return `'${value.replace(/'/g, "''")}'`;
    }

    private shiftParameters(
        sql: string,
        offset: number
    ): string {
        if (!offset) {
            return sql;
        }

        return sql.replace(
            /\$(\d+)/g,
            (_, index) =>
                `$${Number(index) + offset}`
        );
    }
}
