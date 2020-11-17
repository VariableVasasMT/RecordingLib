import RecordingErrors, { ERROR_CODES } from '../../error/index'
import { TrackerInterface } from '../types'
import { RECORDING_PREFIX } from '../constants'
import { DBInterface, DBFactory } from './types'
import { dataUriToBlob } from './utils'

class DB implements DBInterface {
  tracker: TrackerInterface
  DB_NAME: string
  DB_VERSION: number
  DB_STORE_NAME: string
  indexedDB: IDBFactory
  db!: IDBDatabase
  constructor(id: string, trackerObj: TrackerInterface, version = 4) {
    if (!trackerObj) {
      throw new RecordingErrors(ERROR_CODES.NO_TRACKER)
    }
    this.DB_NAME = `${RECORDING_PREFIX}${id}`
    this.DB_VERSION = version
    this.DB_STORE_NAME = id
    this.tracker = trackerObj
    this.indexedDB =
      window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.msIndexedDB
  }

  open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request: IDBOpenDBRequest = indexedDB.open(this.DB_NAME, this.DB_VERSION)
      request.onupgradeneeded = (event: IDBVersionChangeEvent): any => {
        this.db = request.result
        const objectStore = this.db.createObjectStore(this.DB_STORE_NAME)
        console.log('Creating DB with store', this.DB_STORE_NAME, objectStore)
        objectStore.createIndex('objectType', 'objectType', { unique: false })
        this.tracker.track('debug_event', {
          name: 'CreatingDB',
          event: 'create'
          // cname: cname,
          // userId: learnerJson.id
        })
        resolve(this.db)
      }
      request.onsuccess = (event: Event) => {
        this.tracker.track('Success on creating db store', this.DB_STORE_NAME)
        this.db = request.result
        resolve(this.db)
      }
      request.onerror = (event: Event) => {
        this.tracker.track('debug_event', {
          name: 'ErrorDB',
          event: 'open',
          err: request.error?.name
          // cname: cname,
          // userId: learnerJson.id,
        })
        reject(event)
      }
    })
  }

  getAll(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const req = this.getObjectStore('readonly').getAll()
      req.onsuccess = evt => {
        const value = req.result
        resolve(value)
      }
      req.onerror = evt => {
        this.tracker.track('debug_event', {
          name: 'ErrorDB',
          event: 'getAll',
          // cname: cname,
          // userId: learnerJson.id,
          err: req.error?.name
        })
        reject(new RecordingErrors(ERROR_CODES.FAILED_TO_GET_ALL_KEYS))
      }
    })
  }

  getKey(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject(new RecordingErrors(ERROR_CODES.DB_NOT_YET_OPEN))
      }
      const req = this.getObjectStore('readonly').get(key)
      req.onsuccess = async evt => {
        const value = req.result
        if (key.startsWith('Blob') && typeof value === 'string') {
          try {
            const blob: Blob = await dataUriToBlob(value)
            resolve(blob)
          } catch (e) {
            console.log(e)
            reject(new RecordingErrors(ERROR_CODES.DB_NO_SUCH_KEY))
            this.tracker.track('debug_event', {
              name: 'ErrorDB',
              event: 'convertDataUriToBlob',
              // cname: cname,
              // userId: learnerJson.id,
              err: JSON.stringify(e)
            })
          }
          return
        }
        if (value) resolve(value)
        else {
          reject(new RecordingErrors(ERROR_CODES.DB_NO_SUCH_KEY))
        }
      }
      req.onerror = evt => {
        this.tracker.track('debug_event', {
          name: 'ErrorDB',
          event: 'getKey',
          // cname: cname,
          // userId: learnerJson.id,
          err: req.error?.name
        })
        reject(new RecordingErrors(ERROR_CODES.DB_ERROR_WHILE_GETTING_KEY))
      }
    })
  }

  putValue(key: string, value: any): Promise<boolean> {
    console.log('Putting key ==', key)
    return this._putAndCheck(key, value)
  }

  getObjectStore(type: 'readonly' | 'readwrite' | 'versionchange' | undefined): IDBObjectStore {
    return this.db
      .transaction(this.DB_STORE_NAME, type || 'readonly')
      .objectStore(this.DB_STORE_NAME)
  }

  private _putAndCheck(key: string, value: any): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this._parseDbValue(key, value).then(
        _value => {
          const req: IDBRequest<IDBValidKey> = this.getObjectStore('readwrite').put(_value, key)

          req.onsuccess = function(evt) {
            resolve(true)
          }
          req.onerror = evt => {
            this.tracker.track('debug_event', {
              name: 'ErrorDB',
              event: 'putValue',
              // cname: cname,
              // userId: learnerJson.id,
              err: req.error?.name
            })
            reject(new RecordingErrors(ERROR_CODES.DB_ERROR_WHILE_PUTTING_KEY))
          }
        },
        e => {
          this.tracker.track('debug_event', {
            name: 'ErrorDB',
            event: 'errorParseDbValue',
            // cname: cname,
            // userId: learnerJson.id,
            err: JSON.stringify(e)
          })
          reject(new RecordingErrors(ERROR_CODES.DB_ERROR_WHILE_PUTTING_KEY))
        }
      )
    })
  }

  private _blobToDataUri(blob: Blob) {
    let reader: FileReader

    return new Promise(function(resolve, reject) {
      reader = new FileReader()
      reader.onloadend = function() {
        const base64data = reader.result
        resolve(base64data)
      }
      reader.onerror = function(e) {
        reject(e)
      }
      reader.readAsDataURL(blob)
    })
  }

  private _parseDbValue(key: string, value: any) {
    return new Promise((resolve, reject) => {
      if (key.startsWith('Blob')) {
        this._blobToDataUri(value).then(
          uri => {
            resolve(uri)
          },
          e => {
            this.tracker.track('debug_event', {
              name: 'ErrorDB',
              event: 'convertBlobToUri',
              // cname: cname,
              // userId: learnerJson.id,
              err: 'message: ' + e.message + ' stack: ' + e.stack
            })
            reject(e)
          }
        )
      } else {
        resolve(value)
      }
    })
  }

  deleteKey(key: string): Promise<boolean> {
    if (!this.db) {
      return Promise.reject(new RecordingErrors(ERROR_CODES.DB_NOT_YET_OPEN))
    }

    this.tracker.track('delete', key)

    return new Promise((resolve, reject) => {
      const req = this.getObjectStore('readwrite')['delete'](key)
      req.onsuccess = evt => {
        this.tracker.track('Successfully deleted the key', key)
        resolve(true)
      }
      req.onerror = evt => {
        this.tracker.track('debug_event', {
          name: 'ErrorDB',
          event: 'deleteKey',
          // cname: cname,
          // userId: learnerJson.id,
          err: req.error?.name
        })
        reject(new RecordingErrors(ERROR_CODES.DB_ERROR_WHILE_DELETING_KEY))
      }
    })
  }

  getTypeIndex(): IDBIndex {
    return this.getObjectStore('readonly').index('objectType')
  }

  clearObjectStore(): void {
    this.getObjectStore('readwrite').clear()
  }

  static initialize = async (
    id: string,
    trackerObj: TrackerInterface,
    version?: number
  ): Promise<DBInterface> => {
    try {
      if (dbs[id]) return dbs[id]
      dbs[id] = new DB(id, trackerObj, version)
      await dbs[id].open()
      return dbs[id]
    } catch (e) {
      throw new RecordingErrors(ERROR_CODES.FAILED_DB_INIT)
    }
  }
}
const dbs: DBFactory = {}

export default DB
