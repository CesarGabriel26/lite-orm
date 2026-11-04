import {
    Fields,
    Sort
} from './types/filter';

import {
    EntityConstructor,
    EntityResolver,
    FieldStructure,
    RelationStructure,
    RelationType,
    TableStructure
} from './types/structure';

type TableOptions<T extends Record<string, any>> = {
    name?: string;
    primaryKey?: keyof T | string;
    primaryKeys?: Array<keyof T | string>;
};

type TableInput<T extends Record<string, any>> =
    | string
    | TableOptions<T>;

type FieldOptions =
    | string
    | (Partial<FieldStructure> & {
        name?: string;
    });

type RelationOptions<
    T extends Record<string, any>,
    R extends Record<string, any>
> = {
    entity: EntityResolver<R>;
    localField: keyof T | string;
    foreignField: keyof R | string;
    alias?: string;
    fields?: Fields<R>;
    sort?: Sort<R>;
};

interface TableDraft<T extends Record<string, any> = Record<string, any>> {
    input?: TableInput<T>;
    fields: Record<string, FieldStructure>;
    relations: Record<string, RelationStructure<T, any>>;
}

const drafts =
    new WeakMap<Function, TableDraft<any>>();

const tablesByEntity =
    new WeakMap<Function, TableStructure<any>>();

const tablesByName =
    new Map<string, TableStructure<any>>();

export function table<
    T extends Record<string, any>
>(input: TableInput<T> = {}): ClassDecorator {
    return target => {
        const draft =
            getDraft<T>(target);

        draft.input = input;

        registerTable(
            target as unknown as EntityConstructor<T>
        );
    };
}

export function field(
    options: FieldOptions = {}
): PropertyDecorator {
    return (
        target,
        propertyKey
    ) => {
        const property =
            String(propertyKey);

        const normalized =
            normalizeFieldOptions(
                property,
                options
            );

        getDraft(target).fields[property] =
            normalized;
    };
}

export function many_to_one<
    T extends Record<string, any>,
    R extends Record<string, any>
>(options: RelationOptions<T, R>): PropertyDecorator {
    return relationDecorator(
        'manyToOne',
        options
    );
}

export function one_to_many<
    T extends Record<string, any>,
    R extends Record<string, any>
>(options: RelationOptions<T, R>): PropertyDecorator {
    return relationDecorator(
        'oneToMany',
        options
    );
}

export function one_to_one<
    T extends Record<string, any>,
    R extends Record<string, any>
>(options: RelationOptions<T, R>): PropertyDecorator {
    return relationDecorator(
        'oneToOne',
        options
    );
}

export const manyToOne =
    many_to_one;

export const oneToMany =
    one_to_many;

export const oneToOne =
    one_to_one;

export function getTableStructure<
    T extends Record<string, any>
>(entity: EntityConstructor<T>): TableStructure<T> {
    const existing =
        tablesByEntity.get(entity);

    if (existing) {
        return existing;
    }

    const draft =
        drafts.get(entity);

    if (!draft?.input) {
        throw new Error(
            `Table metadata not found for "${entity.name}". Did you add @table(...)?`
        );
    }

    return registerTable(entity);
}

export function resolveEntityStructure<
    T extends Record<string, any>
>(target: TableStructure<T> | EntityConstructor<T>): TableStructure<T> {
    if (isTableStructure(target)) {
        return target;
    }

    return getTableStructure(target);
}

export function resolveRelatedStructure<
    T extends Record<string, any>
>(resolver: EntityResolver<T>): TableStructure<T> {
    const entity =
        isClass(resolver)
            ? resolver
            : resolver();

    return getTableStructure(entity);
}

export function snakeCase(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[-\s]+/g, '_')
        .toLowerCase();
}

function relationDecorator<
    T extends Record<string, any>,
    R extends Record<string, any>
>(
    type: RelationType,
    options: RelationOptions<T, R>
): PropertyDecorator {
    return (
        target,
        propertyKey
    ) => {
        const property =
            String(propertyKey);

        getDraft<T>(target).relations[property] = {
            ...options,
            property,
            type,
            localField: String(options.localField),
            foreignField: String(options.foreignField),
            alias: options.alias ?? property
        };
    };
}

function registerTable<
    T extends Record<string, any>
>(entity: EntityConstructor<T>): TableStructure<T> {
    const draft =
        getDraft<T>(entity);

    const tableOptions =
        normalizeTableOptions(
            entity,
            draft.input
        );

    const fields =
        {
            ...draft.fields
        } as TableStructure<T>['fields'];

    const primaryKeys =
        normalizePrimaryKeys(
            tableOptions,
            fields
        );

    const structure: TableStructure<T> = {
        entity,
        name: tableOptions.name,
        fields,
        primaryKeys,
        relations: {
            ...draft.relations
        }
    };

    tablesByEntity.set(
        entity,
        structure
    );

    tablesByName.set(
        structure.name,
        structure
    );

    return structure;
}

function normalizeTableOptions<
    T extends Record<string, any>
>(
    entity: EntityConstructor<T>,
    input?: TableInput<T>
): Required<TableOptions<T>> {
    const normalized =
        typeof input === 'string'
            ? { name: input }
            : input ?? {};

    const primaryKeys =
        normalized.primaryKeys ??
        (
            normalized.primaryKey
                ? [normalized.primaryKey]
                : []
        );

    return {
        name:
            normalized.name ??
            snakeCase(entity.name),

        primaryKey:
            primaryKeys[0] ??
            '',

        primaryKeys
    };
}

function normalizeFieldOptions(
    property: string,
    options: FieldOptions
): FieldStructure {
    const normalized =
        typeof options === 'string'
            ? { name: options }
            : options;

    return {
        ...normalized,
        name:
            normalized.name ??
            snakeCase(property)
    };
}

function normalizePrimaryKeys<
    T extends Record<string, any>
>(
    tableOptions: Required<TableOptions<T>>,
    fields: TableStructure<T>['fields']
): Array<keyof T | string> {
    if (tableOptions.primaryKeys.length) {
        return tableOptions.primaryKeys;
    }

    const decoratedKeys =
        Object.entries(fields)
            .filter(([, field]) =>
                field.primaryKey
            )
            .map(([property]) =>
                property
            );

    if (decoratedKeys.length) {
        return decoratedKeys;
    }

    return fields.id
        ? ['id']
        : [];
}

function getDraft<
    T extends Record<string, any>
>(target: object | Function): TableDraft<T> {
    const entity =
        getEntityConstructor(target);

    let draft =
        drafts.get(entity) as TableDraft<T> | undefined;

    if (!draft) {
        draft = {
            fields: {},
            relations: {}
        };

        drafts.set(
            entity,
            draft
        );
    }

    return draft;
}

function getEntityConstructor(
    target: object | Function
): Function {
    return typeof target === 'function'
        ? target
        : target.constructor;
}

function isTableStructure<
    T extends Record<string, any>
>(target: TableStructure<T> | EntityConstructor<T>): target is TableStructure<T> {
    return Object.prototype
        .hasOwnProperty.call(
            target,
            'fields'
        );
}

function isClass<T extends Record<string, any>>(
    value: EntityResolver<T>
): value is EntityConstructor<T> {
    return /^class\s/.test(
        Function.prototype.toString.call(value)
    );
}
