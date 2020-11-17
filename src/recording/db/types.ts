import { TrackerInterface } from '../types'
export interface EventTargetWithErrorCode extends EventTarget {
  errorCode: string
}
export interface EventWithTarget extends Event {
  target: EventTargetWithErrorCode
}
export interface DBInterface {
  tracker: TrackerInterface
  DB_NAME: string
  DB_VERSION: number
  DB_STORE_NAME: string
  indexedDB: IDBFactory
  db: IDBDatabase
  open(): Promise<IDBDatabase>
  getAll(): Promise<any[]>
  getKey(key: string): Promise<any>
  putValue(key: string, value: any): Promise<boolean>
  getObjectStore(type: 'readonly' | 'readwrite' | 'versionchange' | undefined): IDBObjectStore
  deleteKey(key: string): Promise<boolean>
  getTypeIndex(): IDBIndex
  clearObjectStore(): void
}

export interface DBFactory {
  [dbId: string]: DBInterface
}
