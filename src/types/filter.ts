export type FilterOperations<T> = {
    $eq?: T;
    $ne?: T;

    $gt?: T;
    $gte?: T;

    $lt?: T;
    $lte?: T;

    $between?: [T, T];

    $like?: T;
    $ilike?: T;
    $tsquery?: string;

    $in?: T[];
    $notIn?: T[];

    /**
     * PostgreSQL array containment:
     *
     * column @> value
     */
    $any?: T;
};

export type FilterField<T> =
    | T
    | null
    | FilterOperations<T>;

export type FilterFields<T> = {
    [K in keyof T]?: FilterField<T[K]>;
};

export type Filter<T> =
    FilterFields<T> & {
        [key: string]: any;

        $or?: Filter<T>[];
        $and?: Filter<T>[];
    };

export type Sort<T> =
    Partial<Record<keyof T | string, 'asc' | 'desc'>>;

export interface Fields<T> {
    $include?: Array<keyof T | string>;
    $exclude?: Array<keyof T | string>;
}
