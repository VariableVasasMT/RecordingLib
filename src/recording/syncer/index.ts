import { SyncerInterface, TrackerInterface, AwsServiceInterface } from '../types'

import Queue from '../queue'
import { DBInterface } from '../db/types'
import {
  UploadStatusTypes,
  UploadStatusValueTypes,
  RecordingStatusTypes,
  RecordingStatusValueTypes
} from './types'
import { QueueInterface } from '../queue/types'

class Syncer implements SyncerInterface {
  static initializeSyncer = (
    db: DBInterface,
    trackerObj: TrackerInterface,
    awsService: AwsServiceInterface
  ) => {
    const syncer = new Syncer(db, trackerObj, awsService)
    return syncer
  }

  db: DBInterface
  tracker: TrackerInterface
  awsService: AwsServiceInterface
  allQueues: QueueInterface[]
  uploadStatus: UploadStatusValueTypes = Syncer.UploadStatus.INACTIVE
  recordingStatus: RecordingStatusValueTypes = Syncer.RecordingStatus.INACTIVE

  static UploadStatus: UploadStatusTypes = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    CANCELLED: 'Cancelled'
  }

  static RecordingStatus: RecordingStatusTypes = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    CANCELLED: 'Cancelled'
  }

  constructor(db: DBInterface, trackerObj: TrackerInterface, awsService: AwsServiceInterface) {
    this.db = db
    this.tracker = trackerObj
    this.awsService = awsService
    this.allQueues = []
  }

  static fromJson = (
    json: QueueInterface,
    tracker: TrackerInterface,
    awsService: AwsServiceInterface,
    db: DBInterface
  ) => {
    const q = Queue.fromJson(json, tracker, awsService, db)
    q.liveQueue = false
    return q
  }

  checkIfcomplete = async (onComplete: Function) => {
    const s3Objs: string[] = []
    const shouldComplete = this.allQueues
      .map(q => {
        s3Objs.push(q.s3Obj)
        return !!q.s3Obj
      })
      .reduce((acc, val) => {
        return acc && val
      }, true)
    if (shouldComplete) {
      await onComplete(s3Objs)
    }
  }
  attachQueue(q: QueueInterface) {
    this.tracker.track('debug_event', {
      name: 'QueueAttaching',
      key: q.queueKey,
      type: q.type,
      draftId: q.draftId
    })
    this.allQueues.push(q)
  }

  stopSyncer(db) {
    this.allQueues.forEach(function(q) {
      q.stopProcessor(db)
    })
  }

  setRecordingStatus(newStatus) {
    this.recordingStatus = newStatus
  }

  getRecordingStatus() {
    return this.recordingStatus
  }

  getUploadStatus() {
    return this.uploadStatus
  }

  setUploadStatus(newUploadStatus: UploadStatusValueTypes) {
    this.uploadStatus = newUploadStatus
  }

  loadQueuesFromDB = draftId => {
    const tracker = this.tracker
    return new Promise((resolve, reject) => {
      try {
        const queueKeyPrefix = `Queue_${draftId}_`
        const queueList = []
        const singleKeyRange = IDBKeyRange.only('queue')
        const cursorRequest = this.db.getTypeIndex().openCursor(singleKeyRange)
        cursorRequest.onsuccess = event => {
          let lockStarted = false
          try {
            var cursor = event.target.result
            if (cursor) {
              if (!cursor.primaryKey.startsWith(queueKeyPrefix)) {
                cursor.continue()
                return
              }

              console.log('queue state: ', cursor.value)
              var q = fromJson(cursor.value, this.tracker, this.awsService)
              if (
                (q.status != Queue.status.DONE ||
                  q.status != Queue.status.ERROR ||
                  q.status !== Queue.status.NO_DATA) &&
                q.wasStopped
              ) {
                queueList.push(q)

                // q.startLock(this.db, this, onError, onProgress, onComplete);
                lockStarted = true
                this.attachQueue(q)
              } else if (!cursor.value.wasStopped) {
                q.flushEverything(this.db)
              }

              cursor.continue()
            } else {
              return resolve(queueList)
            }
          } catch (e) {
            if (lockStarted) {
              q.deleteLock(this.db)
            }

            return reject(e)
          }
        }

        cursorRequest.onerror = function(e) {
          console.log('ERROR in cursorRequest', e)
          tracker.track('debug_event', {
            name: 'ErrorGettingCursorRequest',
            // cname     : cname,
            // userId    : learnerJson.id,
            error: JSON.stringify(e)
          })
          reject(e)
        }
      } catch (e) {
        reject(e)
      }
    })
  }
}

const initiateBackgroundSyncForDraftId = (Syncer.initiateBackgroundSyncForDraftId = async options => {
  console.log('Initiating background sync for draft id: %s', options.draftId)
  const { draftId, db, tracker, awsService, onError, onProgress, onComplete } = options

  try {
    const syncer = new Syncer(db, tracker, awsService)
    return await syncer.backgroundSyncForDraftId(draftId, onError, onProgress, onComplete)
  } catch (e) {
    throw e
  }
})

Syncer.initiateBackgroundSync = function(db, trackerObj, awsService) {
  console.log('Initiating background sync')

  return new Promise((resolve, reject) => {
    try {
      const syncer = new Syncer(db, trackerObj, awsService)

      const singleKeyRange = IDBKeyRange.only('queue')
      const cursorRequest = db.getTypeIndex().openCursor(singleKeyRange)

      cursorRequest.onsuccess = event => {
        let lockStarted = false
        try {
          var cursor = event.target.result
          if (cursor) {
            console.log('queue state: ', cursor.value)
            var q = fromJson(cursor.value, trackerObj, awsService)
            if (
              (q.status != Queue.status.DONE ||
                q.status != Queue.status.ERROR ||
                q.status !== Queue.status.NO_DATA) &&
              q.wasStopped
            ) {
              q.startLock(
                db,
                syncer,
                err => {
                  console.log('error in background sync', err)
                },
                (uploadedSize, totalSize) => {
                  console.log('uploaded size: %s, total size: %s', uploadedSize, totalSize)
                },
                url => {
                  console.log('sync completed. URL: ', url)
                }
              )
              lockStarted = true
              syncer.attachQueue(q)
            } else if (!cursor.value.wasStopped) {
              q.flushEverything(db)
            }
            cursor['continue']()
          } else {
            resolve()
          }
        } catch (e) {
          if (lockStarted) {
            q.deleteLock(db)
          }

          return reject(e)
        }
      }

      cursorRequest.onerror = function(e) {
        console.log('ERROR in cursorRequest', e)
        trackerObj.track('debug_event', {
          name: 'ErrorGettingCursorRequest',
          // cname     : cname,
          // userId    : learnerJson.id,
          error: JSON.stringify(e)
        })
        reject(e)
      }
    } catch (e) {
      reject(e)
    }
  })
}

export default Syncer
