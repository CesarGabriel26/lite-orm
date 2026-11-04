import {
    Repository,
    GenericRepository,
    getRepository,
    QueryExecutor
} from './driver/repository';

import {
    EntityConstructor,
    EntityResolver,
    FieldType,
    RelationStructure,
    RelationType,
    TableStructure
} from './types/structure';

import {
    FindOptions,
    PaginateOptions,
    PaginatedResult,
    FindResult,
    BuiltQuery,
    PaginationConfig
} from './types/query';

import {
    Filter,
    FilterOperations,
    Sort,
    Fields
} from './types/filter';

import {
    field,
    table,
    getTableStructure,
    many_to_one,
    manyToOne,
    one_to_many,
    oneToMany,
    one_to_one,
    oneToOne,
    resolveEntityStructure
} from './decorators';

import {
    database,
    pool,
    initDatabase,
    getPool,
    getDatabase,
    closeDatabase,
    checkConnection,
    checkDatabaseHealth
} from './pool';

import {
    PgDatabase,
    TransactionContext
} from './driver/pg.driver';

import {
    SqlBuilder
} from './builders/sqlBuilder';

import {
    FilterBuilder
} from './builders/filterBuilder';

export {
    // Repositório e Execução
    Repository,
    GenericRepository,
    getRepository,
    QueryExecutor,

    // Database e Pool
    database,
    pool,
    initDatabase,
    getPool,
    getDatabase,
    closeDatabase,
    checkConnection,
    checkDatabaseHealth,
    PgDatabase,
    TransactionContext,

    // Decorators
    table,
    field,
    many_to_one,
    manyToOne,
    one_to_many,
    oneToMany,
    one_to_one,
    oneToOne,
    getTableStructure,
    resolveEntityStructure,

    // Query & Filter Types
    FindOptions,
    PaginateOptions,
    PaginatedResult,
    FindResult,
    BuiltQuery,
    PaginationConfig,
    Filter,
    FilterOperations,
    Sort,
    Fields,

    // Metadados & Estruturas
    EntityConstructor,
    EntityResolver,
    FieldType,
    RelationStructure,
    RelationType,
    TableStructure,

    // Builders internos
    SqlBuilder,
    FilterBuilder
};
