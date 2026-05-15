/** JSON-compatible value type */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
