import {
    Fields,
    Sort
} from './filter';

export enum FieldType {
    DATE_TIME = 'DATE_TIME',
    DATE = 'DATE',
    TIMESTAMP = 'TIMESTAMP',
    TSVECTOR = 'TSVECTOR',

    SMALLINT_ARRAY = 'SMALLINT_ARRAY',
    STRING_ARRAY = 'STRING_ARRAY',
    UUID_ARRAY = 'UUID_ARRAY',

    JSONB = 'JSONB',
}

export type EntityConstructor<
    T extends Record<string, any> = Record<string, any>
> = new (...args: any[]) => T;

export type EntityResolver<
    T extends Record<string, any> = Record<string, any>
> =
    | EntityConstructor<T>
    | (() => EntityConstructor<T>);

export interface FieldStructure {
    /**
     * Nome real da coluna no PostgreSQL.
     *
     * Ex:
     * createdAt -> created_at
     */
    name: string;

    type?: FieldType;

    primaryKey?: boolean;
    generated?: boolean;
}

export type RelationType =
    | 'oneToMany'
    | 'manyToOne'
    | 'oneToOne';

export interface RelationStructure<
    T extends Record<string, any> = Record<string, any>,
    R extends Record<string, any> = Record<string, any>
> {
    property: string;
    type: RelationType;

    entity: EntityResolver<R>;

    localField: string;
    foreignField: string;

    alias?: string;
    fields?: Fields<R>;
    sort?: Sort<R>;
}

export interface TableStructure<T extends Record<string, any>> {
    /**
     * Nome real da tabela.
     */
    name: string;

    /**
     * Mapeamento:
     *
     * propriedade TS -> coluna PostgreSQL
     */
    fields: Partial<{
        [K in keyof T]: FieldStructure;
    }> & Record<string, FieldStructure>;

    /**
     * Primary keys da tabela.
     */
    primaryKeys: Array<keyof T | string>;

    relations?: Record<string, RelationStructure<T, any>>;

    entity?: EntityConstructor<T>;
}
