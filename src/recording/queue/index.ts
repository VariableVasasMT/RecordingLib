import {
  QueueStatusType,
  QueueTypes,
  QueueExtraInfo,
  QueueStatusInterface,
  QueueInterface,
  S3ObjInterface,
  UploadStatusTypes,
  RecordingStatusTypes,
  UploadStatusValueTypes,
  RecordingStatusValueTypes,
  AudioQueueType
} from './types'
import { TrackerInterface, AwsServiceInterface, RecordingType, AudioType } from '../types'
import { DBInterface } from '../db/types'
import Syncer from '../syncer'
import RecordingErrors, { ERROR_CODES } from '../../error'

class Queue implements QueueInterface {
  tracker: TrackerInterface
  db: DBInterface
  s3Obj!: S3ObjInterface
  awsService: AwsServiceInterface
  uploadPath?: string
  stitchPath?: string
  lockIntervalId!: NodeJS.Timeout | null
  objectType?: 'queue'
  wasStopped: boolean
  status: QueueStatusType
  type?: QueueTypes
  startTime: number
  endTime: number
  recordQueue: Array<any>
  chunkSize: Array<number>
  totalSize: number
  uploadedSize: number
  chunksUploaded: number
  recordingState!: string
  liveQueue: boolean
  mediaKeys: Array<string>
  queueIntervalId: NodeJS.Timeout | null = null
  period = 10000
  draftId?: string
  contentType?: string
  stitchingInProgress: boolean
  extraInfo: QueueExtraInfo
  queueKey: string
  flushKey: string
  lockKey: string
  errorGettingElement: number
  errorInvokingConcatLambda: number
  networkDown: boolean
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

  static status: QueueStatusInterface = {
    DONE: 'Done',
    LOADING: 'Loading',
    PENDING: 'Pending',
    STITCHING: 'Stitching',
    ERROR: 'Error',
    DELETE: 'Delete',
    PROCESSING: 'Processing',
    UPLOADING: 'Uploading',
    NO_DATA: 'NoData'
  }

  constructor(
    trackerObj: TrackerInterface,
    awsServiceParam: AwsServiceInterface,
    db: DBInterface,
    type?: QueueTypes,
    draftId?: string,
    uploadPath?: string,
    stitchPath?: string
  ) {
    // if (!dbObjectParam || !s3ApiObjectParam || !syncerObjectParam ||
    // !lambdaApiObjectParam) {
    //   throw new Error("Pass missing arguments to initialize Queue");
    // }
    this.awsService = awsServiceParam
    this.tracker = trackerObj
    this.db = db
    this.uploadPath = uploadPath
    this.stitchPath = stitchPath
    this.objectType = 'queue'
    this.wasStopped = false
    this.status = Queue.status.PENDING
    this.type = type
    this.startTime = 0
    this.endTime = 0
    this.recordQueue = []
    this.chunkSize = []
    this.totalSize = 0

    this.uploadedSize = 0
    this.chunksUploaded = 0
    this.liveQueue = true
    this.mediaKeys = []
    this.draftId = draftId
    this.stitchingInProgress = false
    this.extraInfo = {}
    this.queueKey = 'Queue_' + draftId + '_' + type
    this.flushKey = 'Flush_' + draftId + '_' + type
    this.errorGettingElement = 0
    this.errorInvokingConcatLambda = 0
    this.networkDown = false
    if (type as AudioQueueType) {
      this.contentType = 'audio/webm'
    } else {
      this.contentType = 'video/webm'
    }
    /*** Locking */
    this.lockKey = 'Lock_' + draftId + '_' + type
    /************/
  }

  static fromJson(
    json: QueueInterface,
    tracker: TrackerInterface,
    awsService: AwsServiceInterface,
    db: DBInterface
  ): Queue {
    const q = new Queue(tracker, awsService, db)
    return q
  }

  jsonToQueue(json: QueueInterface) {
    this.uploadPath = json.uploadPath
    this.stitchPath = json.stitchPath
    this.objectType = json.objectType
    this.wasStopped = json.wasStopped
    this.status = json.status
    this.type = json.type
    this.startTime = json.startTime
    this.endTime = json.endTime
    this.recordQueue = json.recordQueue
    this.chunkSize = json.chunkSize
    this.totalSize = json.totalSize
    this.uploadedSize = json.uploadedSize
    this.chunksUploaded = json.chunksUploaded
    this.liveQueue = json.liveQueue
    this.mediaKeys = json.mediaKeys
    this.draftId = json.draftId
    this.stitchingInProgress = json.stitchingInProgress
    this.extraInfo = json.extraInfo
    this.queueKey = json.queueKey
    this.flushKey = json.flushKey
    this.errorGettingElement = json.errorGettingElement
    this.errorInvokingConcatLambda = json.errorInvokingConcatLambda
    this.networkDown = json.networkDown
    this.lockKey = json.lockKey
  }
  setEndTime() {
    this.endTime = Date.now()
  }
  setStartTime() {
    this.startTime = Date.now()
  }
  setStatus(status: QueueStatusType) {
    this.status = status
  }

  setRecordingStatus(newStatus: RecordingStatusValueTypes) {
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

  getProgress() {
    return {
      status: this.status,
      uploadedSize: this.uploadedSize,
      totalSize: this.totalSize
    }
  }
  async setStatusAndPush(status: QueueStatusType) {
    if (status !== Queue.status.PENDING) {
      this.tracker.track('debug_event', {
        name: 'QueueState' + status,
        type: this.type,
        draftId: this.draftId
      })
    }
    this.setStatus(status)
    await this.pushQueue()
  }

  private async _deleteElement() {
    if (this.recordQueue.length) {
      const key = this.recordQueue.shift()

      console.log('deleting key', key)

      await this.db.deleteKey(key)
      await this.pushQueue()
    }
  }

  private async _pushElement(value: string) {
    this.recordQueue.push(value)
    await this.pushQueue()
  }
  private _getElement(): Promise<Blob | null> {
    return new Promise(async (resolve, reject) => {
      const key = this.recordQueue[0]
      try {
        if (!key) {
          resolve(null)
          if (!this.liveQueue) {
            await this.setStatusAndPush(Queue.status.STITCHING)
          }
          return
        }
        const val = await this.db.getKey(key)
        resolve(val)
      } catch (err) {
        reject(err)
      }
    })
  }

  private _getQueue() {
    return this.db.getKey(this.queueKey)
  }

  async pushQueue(cb?: Function) {
    const oldStitchingStatus = this.stitchingInProgress
    this.stitchingInProgress = false
    try {
      await this.db.putValue(this.queueKey, this)
      if (cb instanceof Function) {
        cb()
      }
      this.stitchingInProgress = oldStitchingStatus
    } catch (error) {
      console.error('Error pushing the queue to db', error)
      if (cb instanceof Function) cb(error)
    }
  }

  async deleteQueue() {
    await this.db.deleteKey(this.queueKey)
  }

  async cleanUp() {
    await this.stopProcessor()
    await this.deleteQueue()
  }

  async stopProcessor(cb?: Function) {
    if (this.queueIntervalId) {
      clearInterval(this.queueIntervalId)
    }
    if (this.lockIntervalId) {
      clearInterval(this.lockIntervalId)
    }
    this.queueIntervalId = this.lockIntervalId = null

    this.liveQueue = false
    await this.pushQueue(cb)
  }

  private async _handlePendingState(onError: Function, onProgress: Function) {
    if (
      this.getUploadStatus() === Queue.UploadStatus.INACTIVE &&
      ((this.getRecordingStatus() === Queue.RecordingStatus.ACTIVE && this.liveQueue) ||
        this.getRecordingStatus() === Queue.RecordingStatus.INACTIVE)
    ) {
      this.setUploadStatus(Syncer.UploadStatus.ACTIVE)

      try {
        const blob = await this._getElement()

        if (blob) {
          const path = `${this.uploadPath}/${Date.now()}.webm`
          if (this.getUploadStatus() === Syncer.UploadStatus.ACTIVE) onProgress()
          try {
            await this.awsService.uploadToS3(path, blob)
            if (this.getUploadStatus() === Syncer.UploadStatus.CANCELLED) {
              return
            }
            this.networkDown = false
            this.uploadedSize += this.chunkSize[this.chunksUploaded]
              ? this.chunkSize[this.chunksUploaded]
              : 0
            this.chunksUploaded += 1
            this.mediaKeys.push(path)
            await this._deleteElement()
            this.setUploadStatus(Syncer.UploadStatus.INACTIVE)
            onProgress()
          } catch (err) {
            if (err.code === 'NetworkingError') {
              this.networkDown = true
              onError(new RecordingErrors(ERROR_CODES.NETWORK_ERROR))
              await this.pushQueue()
            } else {
              this.tracker.track('debug_event', {
                name: 'S3ErrorUploading',
                type: this.type,
                draftId: this.draftId,
                chunkNumber: this.chunksUploaded + 1,
                error: JSON.stringify(err)
              })
            }
            console.log('Error while uploading', err)
            this.setUploadStatus(Syncer.UploadStatus.INACTIVE)

            // if (err.code) {
            //   return onError(err);
            // }

            // return onError(new MTError(ErrorCode.UPLOAD_FAILED, err));
          }
        } else {
          this.setUploadStatus(Syncer.UploadStatus.INACTIVE)
        }
      } catch (err) {
        // console.log("error in getting element from db", err, this.recordQueue[0]);
        this.errorGettingElement += 1
        if (this.errorGettingElement > 10) {
          await this.setStatusAndPush(Queue.status.ERROR)
          this.tracker.track('debug_event', {
            name: 'ErrorGettingBlobFromDB',
            type: this.type,
            draftId: this.draftId,
            chunkNumber: this.chunksUploaded + 1,
            error: JSON.stringify(err)
          })

          onError(new RecordingErrors(ERROR_CODES.DB_NO_SUCH_KEY_RETRY))
        } else {
          onError(new RecordingErrors(ERROR_CODES.DB_NO_SUCH_KEY))
        }

        // console.log("error in queue _handlePendingState", err);
        this.setUploadStatus(Syncer.UploadStatus.INACTIVE)
      }
    }
  }
  private async _handleStitchingState(
    onError: Function,
    onProgress: Function,
    onComplete: Function
  ) {
    try {
      // debugger;
      this.stitchingInProgress = true
      const path = `${this.stitchPath}/${Date.now()}.webm`
      const startTime = Date.now()
      if (this.mediaKeys.length === 0) {
        await this.setStatusAndPush(Queue.status.NO_DATA)
        this.tracker.track('debug_event', {
          name: 'NoDataToConcat',
          type: this.type,
          draftId: this.draftId,
          concatChunks: this.mediaKeys.length,
          chunkSizeInKB: JSON.stringify(this.chunkSize)
        })
        return
      }
      this.tracker.track('debug_event', {
        name: 'InvokeLambdaConcat',
        type: this.type,
        draftId: this.draftId,
        concatChunks: this.mediaKeys.length,
        chunkSizeInKB: JSON.stringify(this.chunkSize)
      })

      // trigger onProgress
      onProgress()
      // debugger;
      try {
        const data = await this.awsService.invokeLambdaForConcat(
          path,
          this.mediaKeys,
          this.contentType
        )
        const timeDiff = (Date.now() - startTime) / 1000
        const size = []
        console.log('RequestId', data.requestId)
        this.networkDown = false
        this.extraInfo.concatUrl = path
        this.tracker.track('debug_event', {
          name: 'DoneInvokeLambdaConcat',
          awsRequestId: data.requestId,
          type: this.type,
          draftId: this.draftId,
          invocationTimeInSecs: timeDiff
        })
        try {
          const url = await this.awsService.s3SignedUrl(path)
          console.log('SIGNED URL CONCAT', this.type, url)
          await this.stopProcessor(async (err: Error) => {
            if (err) {
              return onError(err)
            }
          })
          this.s3Obj = { s3Path: path, url, type: this.type }

          // await syncerObject.checkIfcomplete(onComplete);
          await this.setStatusAndPush(Queue.status.DONE)
          await onComplete(this.s3Obj)
        } catch (err) {
          console.log(err)
        }
      } catch (e) {
        console.log('Error while invoking lambda', e)
        this.stitchingInProgress = false
        if (e.code === 'NetworkingError') {
          this.networkDown = true
          await this.pushQueue()
        }
        if (!e.retry) {
          this.errorInvokingConcatLambda += 1
          if (this.errorInvokingConcatLambda > 10) {
            this.tracker.track('debug_event', {
              name: 'ErrorInvokeLambdaConcat',
              awsRequestId: e.requestId,
              draftId: this.draftId,
              type: this.type,
              err: JSON.stringify(e)
            })
            await this.setStatusAndPush(Queue.status.ERROR)
          }
        }
      }
    } catch (e) {
      onError(e)
    }
  }

  private async _handleStates(
    status: QueueStatusType,
    onError: Function,
    onProgress: Function,
    onComplete: Function
  ) {
    switch (status) {
      case Queue.status.PENDING:
        await this._handlePendingState(onError, onProgress)
        break
      case Queue.status.STITCHING:
        if (!this.stitchingInProgress) {
          // debugger;
          await this._handleStitchingState(onError, onProgress, onComplete)
        }
        break
      // case Queue.status.DONE:
      case Queue.status.ERROR:
      case Queue.status.NO_DATA:
        await this.deleteLock()
        break
      case Queue.status.DELETE:
        await this.stopProcessor(async () => {
          await this.deleteLock()
          await this.flushEverything()
        })
        break
    }
  }
  private async _getFlushStatus() {
    try {
      const { seen } = await this.db.getKey(this.flushKey)
      await this.db.putValue(this.flushKey, { seen: true })
      return seen ? null : Queue.status.DELETE
    } catch (e) {
      return null
    }
  }
  private async _processor(onError: Function, onProgress: Function, onComplete: Function) {
    try {
      const status = await this._getFlushStatus()
      const state = status || this.status
      console.log(
        'Performing Action on type',
        this.type,
        'for status',
        state,
        this.getUploadStatus(),
        this.getRecordingStatus()
      )
      await this._handleStates(state, onError, onProgress, onComplete)
    } catch (e) {
      onError(e)
    }
  }
  stillExists() {
    return this._getQueue()
  }

  updateFields(q: QueueInterface) {
    this.jsonToQueue(q)
  }

  private async _startProcessor(onError: Function, onProgress: Function, onComplete: Function) {
    try {
      const q = await this.stillExists()
      this.updateFields(q)
      this.queueIntervalId = setInterval(async () => {
        await this._processor(onError, onProgress, onComplete)
      }, Math.floor(Math.random() * 1000 + Queue.PROCESS_INTERVAL))
      await this._processor(onError, onProgress, onComplete)
      this._startUpdateInterval()
      this.tracker.track('debug_event', {
        name: 'StartProcessor',
        type: this.type,
        draftId: this.draftId
      })
    } catch (err) {
      this.status = Queue.status.DELETE
      this.queueIntervalId = setInterval(async () => {
        await this._processor(onError, onProgress, onComplete)
      }, Math.floor(Math.random() * 1000 + Queue.PROCESS_INTERVAL))
      // await this._processor(
      //   dbObject,
      //   syncerObject,
      //   onError,
      //   onProgress,
      //   onComplete
      // );
    }
  }
  async handleBlob(blob: BlobEvent) {
    const key = 'Blob_' + this.draftId + '_' + this.type + '_' + Date.now()
    if (this.getRecordingStatus() === Queue.RecordingStatus.CANCELLED) {
      // console.log("Syncer recording status was inactive.Discarding the blob ", key);
      return Promise.resolve()
    }
    if (blob && blob.data.size > 0) {
      try {
        await this.db.putValue(key, blob.data)
        await this._pushElement(key)
        const size = Math.round(blob.data.size / 1024)
        this.totalSize += size
        this.chunkSize.push(size)
        if (this.recordingState === 'stop') {
          this.tracker.track('debug_event', {
            name: 'StopRecordingType',
            type: this.type,
            draftId: this.draftId,
            concatChunks: this.mediaKeys.length,
            chunkSizeInKB: JSON.stringify(this.chunkSize)
          })
        }
      } catch (e) {
        throw e
      }
    } else {
      return Promise.reject(new RecordingErrors(ERROR_CODES.BROWSER_STALE))
    }
  }

  async flushEverything() {
    const q = await this._getQueue()
    this.updateFields(q)
    if (q) {
      if (q.recordQueue) {
        await Promise.all(
          q.recordQueue.map(async (blobKey: string) => {
            const deleted = await this.db.deleteKey(blobKey)
            return deleted
          })
        )
      }
      if (q.lockKey) {
        await this.db.deleteKey(q.lockKey)
      }
      await this.db.deleteKey(q.queueKey)
      this.tracker.track('debug_event', {
        name: 'FlushEverything' + status,
        draftId: this.draftId,
        type: this.type
      })
    }
    return q
  }

  /*********** Lock Functions *************/

  async deleteLock() {
    if (this.lockIntervalId !== null) clearInterval(this.lockIntervalId)
    await this.db.deleteKey(this.lockKey)
    await this.stopProcessor()
  }

  private async _checkLock(onError: Function, onProgress: Function, onComplete: Function) {
    // console.log("key exists for lock key", that.lockKey);
    try {
      const val = await this.db.getKey(this.lockKey)
      console.log('lock key found', this.lockKey)
      if (Date.now() - val > Queue.LOCK_TIME) {
        await this._startProcessor(onError, onProgress, onComplete)
      }
    } catch (e) {
      console.log('No such key exists adding lock key', this.lockKey)
      await this._updateLock()
      await this._startProcessor(onError, onProgress, onComplete)
    }
  }
  private async _updateLock() {
    console.log('updating lock key', this.lockKey)
    await this.db.putValue(this.lockKey, Date.now())
  }
  private _startUpdateInterval() {
    if (this.lockIntervalId) clearInterval(this.lockIntervalId)
    this.lockIntervalId = setInterval(async () => {
      await this._updateLock()
    }, Queue.LOCK_UPDATE_INTERVAL)
  }

  async startLock(onError: Function, onProgress: Function, onComplete: Function) {
    this.lockIntervalId = setInterval(
      () => this._checkLock(onError, onProgress, onComplete),
      Queue.LOCK_CHECK_INTERVAL
    )
    await this._checkLock(onError, onProgress, onComplete)
  }

  async startProcessor(onError: Function, onProgress: Function, onComplete: Function) {
    try {
      await this._startProcessor(onError, onProgress, onComplete)
    } catch (e) {
      throw e
    }
  }

  static LOCK_UPDATE_INTERVAL = 5000
  static LOCK_TIME = 15 * 1000
  static LOCK_CHECK_INTERVAL = 5000

  /*********** Lock Functions *************/

  static PROCESS_INTERVAL = 3000
}
export default Queue
