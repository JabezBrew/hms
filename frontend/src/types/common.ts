export type EntityId = string | number
export type ISODateString = string

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue
}
