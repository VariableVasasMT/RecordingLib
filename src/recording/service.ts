import {
  RecordingType,
  RecordingServiceInterface,
  DeviceInterface,
  DeviceMapInterface,
  DeviceListInterface,
  RecordingServiceOptionsInterface,
  TrackerInterface,
  SyncerInterface,
  ChildRecorders,
  BaseDeviceIdInterface
} from './types'

import AwsService from '../uploading/aws-service'
import RecordingErrors, { ERROR_CODES } from '../error/'
// import MTRecorder from "./utils/mt-recorder";
// import PermissionError from "./utils/permission-error";
// import Queue from "./utils/queue";
// import RecordStatusUtils from "./utils/record-status";
// import Syncer, { RecordingStatus, UploadStatus } from "./utils/syncer";
import { browserVersion, isChrome, isFirefox, noop } from '../utils/'
import DB from './db'
import { RECORDING_STATUS } from './constants'
import { DBInterface } from './db/types'
import Syncer from './syncer'
import Queue from './queue'
import BaseRecorder from './baseRecorder'
import { Time } from 'aws-sdk/clients/datasync'

const getDeviceLabel = (
  deviceInfo: MediaDeviceInfo,
  audioInputCount: any,
  audioOutputSelectCount: any,
  videoInputCount: any
) => {
  if (deviceInfo.kind === 'audioinput') {
    audioInputCount++
    return deviceInfo.label || 'microphone ' + audioInputCount
  } else if (deviceInfo.kind === 'audiooutput') {
    audioOutputSelectCount++
    return deviceInfo.label || 'speaker ' + audioOutputSelectCount
  } else if (deviceInfo.kind === 'videoinput') {
    videoInputCount++
    return deviceInfo.label || 'camera ' + videoInputCount
  }

  console.log('Some other kind of source/device: ', deviceInfo)
}
function handleDevices(devices: Array<MediaDeviceInfo>): DeviceMapInterface {
  const deviceMap: DeviceMapInterface = {}

  let audioOutputSelectCount = 0
  let audioInputCount = 0
  let videoInputCount = 0

  for (let i = 0; i !== devices.length; ++i) {
    let deviceInfo = devices[i]
    const option: DeviceInterface = {
      kind: deviceInfo.kind,
      deviceId: deviceInfo.deviceId,
      label: getDeviceLabel(deviceInfo, audioInputCount, audioOutputSelectCount, videoInputCount)
    }

    if (!deviceMap[deviceInfo.kind]) {
      deviceMap[deviceInfo.kind] = []
    }
    deviceMap[deviceInfo.kind].push(option)
  }

  return deviceMap
}

export async function enumerateDevicesList() {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return handleDevices(devices)
    }

    throw new Error('Browser not supported')
  } catch (err) {
    throw err
  }
}

export function isSupported(missionType: string) {
  // if(isChrome && browserVersion > 49 || isFirefox && browserVersion > 25) {
  if (isChrome && browserVersion > 49) return true
  // screen capture is only supported on chrome at the moment!
  if (missionType === 'SCREEN_CAPTURE') return false
  else if (isFirefox && browserVersion > 25) return true
  else return false
}

const getDefaultDevices = async (): Promise<BaseDeviceIdInterface> => {
  const devices: DeviceMapInterface = await enumerateDevicesList()
  return {
    audio: devices.audioinput && devices.audioinput[0] && devices.audioinput[0].deviceId,
    video: devices.videoinput && devices.videoinput[0] && devices.videoinput[0].deviceId
  }
}

/**
 * MTRecorderService is the main interface through which the whole recording ecosystem works
 * Ideally it should be initialized once during the whole lifecycle of webapp
 */
/**
 * JAVA CODE for generating credentials
 * * AWSCredentials cred = new BasicAWSCredentials("your-google/aws-access-key-id", "your-google/aws-access-key-secret");
 * * AWSSecurityTokenServiceClient stsClient = new AWSSecurityTokenServiceClient(cred);
 * * GetSessionTokenRequest sessionTokenRequest = new GetSessionTokenRequest();
 * * sessionTokenRequest.setDurationSeconds(EXPIRE_TIMEOUT);
 * * GetSessionTokenResult sessionTokenResult =
 * * * * stsClient.getSessionToken(sessionTokenRequest);
 * * Credentials sesCreds = sessionTokenResult.getCredentials();
 * * return new BasicFederatedCredentialsVo(sesCreds.getAccessKeyId(), sesCreds.getSecretAccessKey(), sesCreds.getSessionToken());
 *
 * Make sure a separate IAM role is created for this limited access
 */

async function validateAndSetDefaultOptions(options: RecordingServiceOptionsInterface) {
  if (!options) {
    throw new Error('Pass options')
  }
  const newOptions = { ...options }

  if (!newOptions.DB_ID) {
    throw new Error('Pass db id')
  }

  if (!newOptions.uploadPathFn) {
    throw new Error('Provide uploadPathFn method')
  }

  if (!newOptions.stitchPathFn) {
    throw new Error('Provide stitchPathFn method')
  }

  if (!newOptions.type) {
    throw new Error('Provide recording type: audio/video/screen/screen-audio/screen-video')
  }

  if (
    ['audio', 'video', 'screen', 'screen-audio', 'screen-video'].indexOf(newOptions.type) === -1
  ) {
    throw new Error('Record Type is invalid')
  }

  if (!newOptions.draftId) {
    throw new Error('Provide draftId')
  }

  if (!newOptions.getCredentialsFn) {
    throw new Error('Provide getCredentialsFn method')
  }

  if (!newOptions.region) {
    throw new Error('Provide region')
  }

  if (!newOptions.s3Bucket) {
    throw new Error('Provide s3Bucket')
  }

  if (!newOptions.devices) {
    newOptions.devices = await getDefaultDevices()
  }

  return newOptions
}

export const getUserMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> => {
  const getUserMedia =
    navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia

  if (!getUserMedia) {
    return Promise.reject(new RecordingErrors(ERROR_CODES.GET_USER_MEDIA_NOT_SUPPORTED))
  }
  return new Promise(function(resolve, reject) {
    getUserMedia.call(navigator, constraints, resolve, reject)
  })
}

export default class RecordingService
  implements RecordingServiceOptionsInterface, RecordingServiceInterface {
  mtRecorders!: ChildRecorders
  onError: Function = noop
  onProgress: Function = noop
  onComplete: Function = noop
  onStop: Function = noop
  db!: DBInterface
  awsService: AwsService
  DB_ID: string
  type: any
  draftId: string
  region: any
  s3Bucket: string
  devices: any
  extensionId: string
  syncer!: SyncerInterface
  tracker: TrackerInterface
  uploadPathFn: Function = noop
  stitchPathFn: Function = noop
  getCredentialsFn: Function = noop
  startRecordingTime!: Date
  dismissedRecording: boolean = false

  /**
   *
   * @param {
   *   getCredentialsFn: function // to get credentials for amazon s3/google cloud storage ( apparently they follow same mechanism to my surprise )
   *   region: string // the region this is being uploaded to, works for both GCP and AWS
   *   s3Bucket: string
   *   db: new DB // instance of DB object from ./db.js, ideally should be initialized here but mt recorder service is not being used it should be.
   *   otherOptions: not necessary options, can be set later in app lifecycle.
   * } options
   */

  static initialize = async function initialize(options: RecordingServiceOptionsInterface) {
    // Check for options validations
    try {
      const newOptions = await validateAndSetDefaultOptions(options)
      const mtRecorderService = new RecordingService(newOptions)

      await mtRecorderService._init()
      // await mtRecorderService.handlePendingQueueStatus(options);

      return mtRecorderService
    } catch (e) {
      // debugger;
      throw e
    }
  }

  constructor(options: RecordingServiceOptionsInterface) {
    const {
      getCredentialsFn,
      region,
      s3Bucket,
      DB_ID,
      type,
      draftId,
      devices,
      uploadPathFn,
      stitchPathFn,
      tracker,
      extensionId
    } = options

    this.onError = noop
    this.onProgress = noop
    this.onComplete = noop
    this.onStop = options.onStop || noop

    this.type = type
    this.draftId = draftId
    this.devices = devices
    this.uploadPathFn = uploadPathFn
    this.stitchPathFn = stitchPathFn
    this.s3Bucket = s3Bucket
    this.DB_ID = DB_ID
    this.tracker = tracker
    this.extensionId = extensionId

    this.awsService = new AwsService(getCredentialsFn, region, s3Bucket, tracker)
    this.awsService
      .fetchCredentials()
      .then(async () => {
        try {
          await this._initDB()
          this.tracker.track('Db initialized!')
        } catch (e) {
          this.tracker.track(e)
        }

        this.syncer = Syncer.initializeSyncer(this.db, options.tracker, this.awsService)
      })
      .catch(e => {
        throw e
      })
    // Object.entries(otherOptions).map(([key, value]: [string, any]) => {
    //   this[key] = value;
    // });
  }

  _initDB = async () => {
    this.db = await DB.initialize(this.DB_ID, this.tracker)
  }
  private _errorHandler = async (err: Object) => {
    console.error(err)
    this.tracker.track('debug_event', {
      name: 'InitializationError',
      draftId: this.draftId,
      type: this.type,
      error: JSON.stringify(err)
    })
    this.syncer.setRecordingStatus(RECORDING_STATUS.INACTIVE)

    await Promise.all(
      Object.values(this.mtRecorders).map(async (mtRecorder: BaseRecorder) => {
        await mtRecorder.stopAndCleanup()
      })
    )

    this.onError(err)

    throw err
  }

  changeDraftId = (newDraftId: string) => {
    this.draftId = newDraftId
  }

  prepareRecording = async ({ devices }: any) => {
    let streams
    try {
      switch (this.type) {
        case 'screen-audio':
        case 'screen-video':
          streams = await this._prepareScreenWithType({ devices })
          break
        case 'audio':
          streams = await this._prepareAudio({ devices })
          break
        case 'video':
          streams = await this._prepareVideo({ devices })
          break
        default:
          console.log('Invalid type mentioned')
          await this._errorHandler(new Error('Invalid type mentioned'))
          break
      }
      await this.syncer.loadQueuesFromDB(this.draftId)
      await Promise.all(this._checkPending())
      return streams
    } catch (e) {
      await this._errorHandler(e)
    }
  }

  getPermission = async () => {
    switch (this.type) {
      case 'screen-audio': {
        try {
          await this.mtRecorders.screen.getExtensionStatus()
          return this.mtRecorders.audio.getPermissions()
        } catch (err) {
          return this.mtRecorders.screen.installPlugin()
        }
        break
      }
      case 'audio':
        return this.mtRecorders.audio.getPermissions()
      case 'video':
        return this.mtRecorders.video.getPermissions()
      case 'screen-video': {
        try {
          await this.mtRecorders.screen.getExtensionStatus()
          return this.mtRecorders.video.getPermissions()
        } catch (err) {
          return this.mtRecorders.screen.installPlugin()
        }
      }
    }
  }

  checkPermission = async () => {
    switch (this.type) {
      case 'screen-audio':
        await this.mtRecorders.screen.getExtensionStatus()
        return this.mtRecorders.audio.checkPermissions()
      case 'audio':
        return this.mtRecorders.audio.checkPermissions()
      case 'video':
        return this.mtRecorders.video.checkPermissions()
      case 'screen-video':
        await this.mtRecorders.screen.getExtensionStatus()
        return this.mtRecorders.video.checkPermissions()
    }
  }

  _init = async () => {
    if (!isSupported(this.type)) {
      return Promise.reject(new Error('Browser or Version not supported'))
    }

    if (this.syncer.getRecordingStatus() === RECORDING_STATUS.INACTIVE) {
      let streams
      try {
        switch (this.type) {
          case 'screen-audio':
          case 'screen-video':
            streams = this._initializeScreenWithType()
            break
          case 'audio':
            streams = this._initializeAudio()
            break
          case 'video':
            streams = this._initializeVideo()
            break
          default:
            console.log('Invalid type mentioned')
            await this._errorHandler(new Error('Invalid type mentioned'))
            break
        }
        await this.syncer.loadQueuesFromDB(this.draftId)
        await Promise.all(this._checkPending())
        return streams
      } catch (e) {
        await this._errorHandler(e)
      }
    } else {
      return Promise.reject(new Error('Recording already in progress'))
    }
  }

  checkIfAnyUploadPending = () => {
    let pending = false
    for (let i = 0; i < this.syncer.allQueues.length; i++) {
      if (
        ![Queue.status.DONE, Queue.status.ERROR, Queue.status.NO_DATA].includes(
          this.syncer.allQueues[i].status
        )
      ) {
        pending = true
      }
    }
    return pending
  }

  _checkPending = () => {
    if (this.syncer.allQueues.length > 0) {
      return this.syncer.allQueues.map(async q => {
        const keySplit = q.queueKey.split('_')
        const type = keySplit[keySplit.length - 1]
        if (this.mtRecorders[type]) {
          this.mtRecorders[type].setQueue(q)
          try {
            // debugger;
            return await this.mtRecorders[type].handlePendingUpload(
              this._onError,
              this._onProgress,
              this._onComplete
            )
          } catch (e) {
            // debugger;
            this.tracker.track(e)
          }
        }
      })
    } else {
      this.onProgress({ status: Queue.status.DONE })
      return [Promise.resolve(true)]
    }
  }

  _setStartRecordingTime(time: Date) {
    this.startRecordingTime = time
  }

  getAllStreams() {
    const mtRecorders = this.mtRecorders
    const streams: ChildRecorders = {}

    if (mtRecorders.screen) {
      streams.screen = mtRecorders.screen.stream
    }
    if (mtRecorders.audio) {
      streams.audio = mtRecorders.audio.stream
    }
    if (mtRecorders.video) {
      streams.video = mtRecorders.video.stream
    }

    return streams
  }

  _initializeVideo() {
    console.log('Initializing Recordings for type: video')
    this.mtRecorders.video = new BaseRecorder(
      { kind: 'video' },
      this.draftId,
      this.devices,
      this.tracker,
      this.extensionId,
      this.db,
      this.syncer,
      this.uploadPathFn,
      this.stitchPathFn,
      this.awsService
    )
  }

  async _prepareVideo({ devices }) {
    if (devices) {
      this.mtRecorders.video.setDevices(devices)
    }
    return this.mtRecorders.video.prepareRecording(this.stopRecording, this._onError)
  }
  _onError = (err: RecordingErrors) => {
    if (this.dismissedRecording) {
      return
    }
    if (
      err &&
      (err.type === ERROR_CODES.BROWSER_STALE || err.type === ERROR_CODES.DB_NO_SUCH_KEY_RETRY)
    ) {
      this.dismissRecording(ERROR_CODES.BROWSER_STALE)
    }
    this.onError(err)
  }

  _onProgress = async () => {
    if (this.dismissedRecording) {
      return
    }
    // get progress from all mtRecorders

    const stats = await Promise.all(
      Object.values(this.mtRecorders).map(recorder => {
        return recorder.getProgress()
      }, [])
    )

    for (let i = 0; i < stats.length; i++) {
      if (!stats[i].totalSize) {
        return
      }
    }

    const statusData = stats.reduce(
      (acc, data) => {
        acc.statusArr.push(data.status)
        acc.totalUploadedSize += data.uploadedSize
        acc.totalSize += data.totalSize
        return acc
      },
      {
        totalUploadedSize: 0,
        totalSize: 0,
        statusArr: []
      }
    )
    await this.onProgress({
      status: this.calculateStatus(statusData.statusArr),
      percentage: parseInt((statusData.totalUploadedSize * 100) / statusData.totalSize, 10)
    })
  }

  calculateStatus = statusArr => {
    if (statusArr.indexOf(Queue.status.PENDING) !== -1) return Queue.status.PENDING
    else if (statusArr.indexOf(Queue.status.STITCHING) !== -1) return Queue.status.STITCHING
    else if (statusArr.indexOf(Queue.status.PROCESSING) !== -1) return Queue.status.PROCESSING
    else if (statusArr.indexOf(Queue.status.ERROR) !== -1) return Queue.status.ERROR
    return Queue.status.DONE
  }

  _onComplete = async url => {
    // All cleaning part should be done here
    if (!url) {
      return
    }
    if (!this.completedUrls) {
      this.completedUrls = []
    }

    this.completedUrls.push(url)
    if (this._isComplete()) {
      await this.onComplete(this.completedUrls)
      await this.done()
    }
  }

  _isComplete() {
    return Object.keys(this.mtRecorders).every(recorderKey => {
      return this.mtRecorders[recorderKey].getComplete()
    })
  }

  done = async () => {
    if (!this._isComplete()) {
      throw new Error('Recording is not yet complete')
    }

    // flush all queue
    await Promise.all(
      Object.keys(this.mtRecorders).map(recorderKey => this.mtRecorders[recorderKey].flushAll())
    )
  }

  _initializeAudio() {
    console.log('Initializing Recordings for type: audio')
    this.mtRecorders.audio = new MTRecorder(
      'audio',
      this.draftId,
      this.devices,
      this.tracker,
      this.extensionId,
      this.db,
      this.syncer,
      this.uploadPathFn,
      this.stitchPathFn,
      this.awsService
    )
  }

  async _prepareAudio({ devices }) {
    if (devices) {
      this.mtRecorders.audio.setDevices(devices)
    }
    return this.mtRecorders.audio.prepareRecording(this.stopRecording, this._onError)
  }

  _initializePartiallyScreen() {
    console.log('Initializing Recordings for type: audio')
    this.mtRecorders.screen = new MTRecorder(
      'screen',
      this.draftId,
      this.devices,
      this.tracker,
      this.extensionId,
      this.db,
      this.syncer,
      this.uploadPathFn,
      this.stitchPathFn,
      this.awsService
    )
  }

  async _initializeScreen() {
    try {
      console.log('Initializing Recordings for type: screen')

      const mtRecorders = this.mtRecorders
      const subType = this.type.split('-')[1]

      const res = await mtRecorders.screen.prepareRecording(this.stopRecording, this._onError)

      if (subType) {
        var extraTrack = mtRecorders[subType].stream.getAudioTracks()[0]
        mtRecorders.screen.addExtraTrack(extraTrack)
        return res
      }
      return 1
    } catch (e) {
      throw e
    }
  }

  async flushQueues() {
    const { mtRecorders } = this
    this.syncer.setRecordingStatus(RECORDING_STATUS.CANCELLED)
    this.syncer.setUploadStatus(UploadStatus.CANCELLED)
    if (mtRecorders.audio) {
      await mtRecorders.audio.dismissRecording()
    }
    if (mtRecorders.video) {
      await mtRecorders.video.dismissRecording()
    }
    if (mtRecorders.screen) {
      await mtRecorders.screen.dismissRecording()
    }
    this.dismissedRecording = true
  }

  stopStream() {
    const { mtRecorders } = this
    if (mtRecorders.audio) {
      mtRecorders.audio.stopStream()
    }
    if (mtRecorders.video) {
      mtRecorders.video.stopStream()
    }
    if (mtRecorders.screen) {
      mtRecorders.screen.stopStream()
    }
  }

  private _initializeScreenWithType() {
    try {
      console.log('Initializing Recordings for type: screen')

      if (this.type == 'screen-audio') {
        this._initializeAudio()
      } else if (this.type == 'screen-video') {
        this._initializeVideo()
      }
      this._initializePartiallyScreen()
    } catch (e) {
      console.log('error while initializing screenWithType')
      throw e
    }
  }

  async _prepareScreenWithType({ devices }) {
    try {
      console.log('Initializing Recordings for type: screen')

      if (this.type == 'screen-audio') {
        return await this._prepareAudio({ devices })
      } else if (this.type == 'screen-video') {
        return await this._prepareVideo({ devices })
      }
    } catch (e) {
      console.log('error while initializing screenWithType')
      throw e
    }
  }

  async initScreen() {
    try {
      const value = await this._initializeScreen()
      return value
    } catch (e) {
      throw e
    }
  }
  async startRecording() {
    const draftId = this.draftId

    this.tracker.track('debug_event', {
      name: 'StartRecordingEntry',
      type: this.type,
      draftId
    })
    this.syncer.setRecordingStatus(RECORDING_STATUS.ACTIVE)

    this.dismissedRecording = false
    this.recordingStopped = false
    this._setStartRecordingTime(Date.now())

    switch (this.type) {
      case 'screen-video':
        this.mtRecorders.screen.startRecording(
          draftId,
          this._onError,
          this._onProgress,
          this._onComplete
        )
        this.mtRecorders.video.startRecording(
          draftId,
          this._onError,
          this._onProgress,
          this._onComplete
        )
        break
      case 'screen-audio':
        this.mtRecorders.screen.startRecording(
          draftId,
          this._onError,
          this._onProgress,
          this._onComplete
        )
        this.mtRecorders.audio.startRecording(
          draftId,
          this._onError,
          this._onProgress,
          this._onComplete
        )
        break
      case 'audio':
        this.mtRecorders.audio.startRecording(
          draftId,
          this._onError,
          this._onProgress,
          this._onComplete
        )
        break
      case 'video':
        this.mtRecorders.video.startRecording(
          draftId,
          this._onError,
          this._onProgress,
          this._onComplete
        )
        break
    }
  }

  dismissRecording(reason) {
    const { syncer, tracker, mtRecorders, type, draftId } = this

    if (syncer.getRecordingStatus() == RECORDING_STATUS.INACTIVE) {
      this.onError(new RecordingErrors(ERROR_CODES.MEDIA_CLOSE_UNEXPECTEDLY))
    }
    if (!this.dismissedRecording && syncer.getRecordingStatus() == RECORDING_STATUS.ACTIVE) {
      tracker.track('debug_event', {
        name: 'DismissRecording',
        type,
        draftId,
        reason: reason
      })
      this.flushQueues()
      if (reason == ERROR_CODES.BROWSER_STALE) {
        this.onError(new RecordingErrors(ERROR_CODES.BROWSER_STALE))
      } else if (reason == ERROR_CODES.MEDIA_CLOSE_UNEXPECTEDLY) {
        this.onError(new RecordingErrors(ERROR_CODES.MEDIA_CLOSE_UNEXPECTEDLY))
      } else if (reason === ERROR_CODES.USER_DIMISSED) {
        return
      } else {
        this.onError(new RecordingErrors(ERROR_CODES.RECORDING_DISMISSED))
      }
    }
  }

  _markAllLastTrickles() {
    const mtRecorders = this.mtRecorders

    if (mtRecorders.audio) {
      mtRecorders.audio.markLastMediaTrickle()
    }
    if (mtRecorders.screen) {
      mtRecorders.screen.markLastMediaTrickle()
    }
    if (mtRecorders.video) {
      mtRecorders.video.markLastMediaTrickle()
    }
  }

  _markAllMtRecordersStopped() {
    this.recordingStopped = true
  }

  stopRecording = async () => {
    return new Promise(async resolve => {
      if (!this.recordingStopped) {
        await this._stopRecording()
      }
      setTimeout(() => {
        resolve()
      }, 1000)
    })
  }

  _cleanUp(dismissRecording) {
    const mtRecorders = this.mtRecorders
    const syncer = this.syncer
    if (dismissRecording) {
      syncer.setRecordingStatus(RECORDING_STATUS.CANCELLED)
    } else {
      syncer.setRecordingStatus(RECORDING_STATUS.INACTIVE)
    }
    syncer.setUploadStatus(syncer.UploadStatus.INACTIVE)
    if (mtRecorders.audio) {
      mtRecorders.audio.stopAndCleanup(dismissRecording)
    }
    if (mtRecorders.video) {
      mtRecorders.video.stopAndCleanup(dismissRecording)
    }
    if (mtRecorders.screen) {
      mtRecorders.screen.stopAndCleanup(dismissRecording)
    }
  }

  async _stopRecording() {
    const recordingTime = parseInt((Date.now() - this.startRecordingTime) / 1000)

    this._markAllLastTrickles()
    this._markAllMtRecordersStopped()
    await this._cleanUp()
    this.tracker.track('debug_event', {
      name: 'StopRecording',
      type: this.type,
      draftId: this.draftId,
      recordingTime: recordingTime
    })
    //this._checkPending();
    this.onStop()
    //this._checkPending();
  }
  // initializeAws
  // initDB
  // permission
  // version check
}
