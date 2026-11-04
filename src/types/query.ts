import {
    Fields,
    Filter,
    Sort
} from './filter';

export interface BuiltQuery {
    sql: string;
    values: unknown[];
}

export interface PaginationConfig {
    pageIndex: number;
    pageSize: number;
}

export interface FindOptions<T> {
    filters?: Filter<T>;
    sort?: Sort<T>;
    fields?: Fields<T>;
    limit?: number;
    offset?: number;
    pagination?: PaginationConfig;
}

export interface PaginateOptions<T> {
    filters?: Filter<T>;
    sort?: Sort<T>;
    fields?: Fields<T>;
    page?: number;
    pageSize?: number;
    pagination?: PaginationConfig;
}

export interface PaginatedResult<T> {
    items: T[];
    pagination: {
        pageIndex: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
    };
}

export interface FindResult<T> {
    items: T[];
    pagination?: {
        pageIndex: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
    };
}
