import {
  RecordingType,
  TrackerInterface,
  SyncerInterface,
  AwsServiceInterface,
  RecordStateValueTypes,
  ScreenVideoType,
  MediaTrackType,
  ScreenAudioType,
  VideoType
} from './types'
import { QueueTypes, S3ObjInterface } from './queue/types'
import { DBInterface } from './db/types'
import Queue from './queue'
import { RECORDING_STATES, CHROME_STORE_URL, RECORDING_EXTENSION_SOURCE } from './constants'
import { noop, getScreenId, isFirefox, convertRecordingTypeToQueueType, isChrome } from '../utils'
import { ScreenMediaStreamConstraints } from '../types'
import RecordingErrors, { ERROR_CODES } from '../error'

export default class BaseRecorder {
  queue!: Queue
  draftId: string
  db: DBInterface
  type: RecordingType
  stopped: boolean
  pluginUrl: string
  maxInterval: number
  extensionId: string
  stream!: MediaStream
  recordInterval: number
  uploadPathFn: Function
  stitchPathFn: Function
  syncer: SyncerInterface
  tracker: TrackerInterface
  completed: boolean = false
  mediaRecorder?: MediaRecorder
  awsService: AwsServiceInterface
  devices: MediaStreamConstraints
  recordIntervalId!: NodeJS.Timeout | null
  recordingState: RecordStateValueTypes

  constructor(
    type: RecordingType,
    draftId: string,
    devices: MediaStreamConstraints,
    trackerObj: TrackerInterface,
    extensionId: string,
    db: DBInterface,
    syncer: SyncerInterface,
    uploadPathFn: Function,
    stitchPathFn: Function,
    awsService: AwsServiceInterface
  ) {
    if (!trackerObj) {
      throw new Error('Please pass tracker to track events')
    }

    if (!extensionId) {
      throw new Error('Please pass extension id')
    }

    if (!db) {
      throw new Error('please pass db instance')
    }

    this.tracker = trackerObj
    this.type = type
    this.devices = devices
    this.draftId = draftId
    this.recordInterval = 10000
    this.maxInterval = 60 * 60 * 1000
    this.recordingState = RECORDING_STATES.ACTIVE
    this.stopped = false
    this.extensionId = extensionId
    this.db = db
    this.syncer = syncer
    this.uploadPathFn = uploadPathFn
    this.stitchPathFn = stitchPathFn
    this.awsService = awsService
    this.pluginUrl = CHROME_STORE_URL + this.extensionId
  }

  setDevices(devices: MediaStreamConstraints) {
    this.devices = devices
  }

  stopStream() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }
    if (!this.stream) {
      return
    }
    if (this.stream.getAudioTracks()[0]) {
      this.stream.getAudioTracks()[0].enabled = false
      this.stream.getAudioTracks()[0].stop()
    }
    if (this.stream.getVideoTracks()[0]) {
      this.stream.getVideoTracks()[0].enabled = false
      this.stream.getVideoTracks()[0].stop()
    }
  }

  async startRecordingstartRecording(
    draftId: string,
    onError: Function,
    onProgress: Function,
    onComplete: Function
  ) {
    const tracker = this.tracker
    if (!this.mediaRecorder) return

    if (this.draftId !== draftId) {
      tracker.track('debug_event', {
        name: 'DraftIdChanged',
        type: this.type,
        oldDraftId: this.draftId,
        newDraftId: draftId
      })
    }
    this.draftId = draftId || this.draftId
    const awsService = this.awsService
    this.queue = new Queue(
      tracker,
      awsService,
      this.db,
      convertRecordingTypeToQueueType(this.type),
      this.draftId,
      this.uploadPathFn(this.draftId, this.type),
      this.stitchPathFn(this.draftId, this.type)
    )
    this.queue.setStartTime()
    await this.queue.setStatusAndPush(Queue.status.PENDING)
    await this.startQueue(onError, onProgress, onComplete)
    this.mediaRecorder.start(this.maxInterval)
    this.syncer.attachQueue(this.queue)
    tracker.track('debug_event', {
      name: 'StartRecording',
      type: this.type,
      draftId: this.draftId
    })
  }

  async startQueue(onError: Function, onProgress: Function, onComplete: Function) {
    await this.queue.startLock(onError, onProgress, async (val: S3ObjInterface) => {
      this.setComplete()
      await onComplete(val)
    })
    await this.queue.setStatusAndPush(Queue.status.PENDING)
  }

  setComplete() {
    this.completed = true
  }

  async stopAndCleanup(dismissRecording?: boolean) {
    const tracker = this.tracker
    console.log('Stopping/Cleaning up for type', this.type)
    tracker.track('debug_event', {
      name: 'StopAndCleanup',
      type: this.type,
      draftId: this.draftId
    })
    if (dismissRecording) {
      this.removeOnEnded()
    }
    if (this.recordIntervalId) {
      clearInterval(this.recordIntervalId)
      this.recordIntervalId = null
    }
    if (this.mediaRecorder && this.mediaRecorder.state != 'inactive') {
      this.mediaRecorder.stop()
    }
    if (this.stream && this.stream.getAudioTracks()[0]) {
      this.stream.getAudioTracks()[0].enabled = false
      this.stream.getAudioTracks()[0].stop()
    }
    if (this.stream && this.stream.getVideoTracks()[0]) {
      this.stream.getVideoTracks()[0].enabled = false
      this.stream.getVideoTracks()[0].stop()
    }
    if (this.queue) {
      this.queue.liveQueue = false
      this.queue.wasStopped = true
      await this.queue.pushQueue()
    }
  }

  removeOnEnded() {
    const videoTracks = this.stream.getVideoTracks()
    videoTracks.forEach(function(stream) {
      stream.onended = noop
    })
    const audioTracks = this.stream.getAudioTracks()
    audioTracks.forEach(function(stream) {
      stream.onended = noop
    })
  }

  async getPermissions() {
    const constraints: MediaStreamConstraints | null = await this.getMediaConstraints(
      convertRecordingTypeToQueueType(this.type)
    )
    if (constraints !== null) {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      stream.getAudioTracks().forEach(function(track: MediaStreamTrack) {
        track.stop()
      })
      stream.getVideoTracks().forEach(function(track: MediaStreamTrack) {
        track.stop()
      })
    }
  }

  getMediaConstraints(type: QueueTypes): Promise<MediaStreamConstraints | null> {
    return new Promise(async (resolve, reject) => {
      switch (type) {
        case 'audio': {
          const audioSource: MediaTrackType =
            this.devices && this.devices.audio ? this.devices.audio : undefined
          resolve({
            audio: (audioSource as MediaTrackConstraints) ? audioSource : {}
          })
          break
        }
        case 'video': {
          const audioSource: MediaTrackType =
            this.devices && this.devices.audio ? this.devices.audio : undefined
          const videoSource: MediaTrackType =
            this.devices && this.devices.video ? this.devices.video : undefined
          const isScreenVideoType = this.type as ScreenVideoType
          resolve({
            audio: (audioSource as MediaTrackConstraints) ? audioSource : {},
            video: (videoSource as MediaTrackConstraints)
              ? {
                  ...Object(videoSource),
                  width: { ideal: isScreenVideoType ? 140 : 672, min: 352 },
                  height: { ideal: isScreenVideoType ? 96 : 378, min: 240 }
                }
              : {}
          })
          break
        }
        case 'screen': {
          try {
            await this.getExtensionStatus()
            try {
              const screenConstraints: ScreenMediaStreamConstraints | null = await getScreenId(
                this.extensionId
              )
              resolve(screenConstraints)
            } catch (e) {
              reject(e)
            }
          } catch (e) {
            console.log('extension not installed')
            reject(e)
          }
          break
        }
      }
    })
  }

  getExtensionStatus() {
    const type = this.type
    return new Promise((resolve, reject) => {
      if (isFirefox) {
        return reject(new Error('not-chrome'))
      } else {
        if ((type as ScreenVideoType) || (type as ScreenAudioType)) {
          const image = document.createElement('img')
          let installed = false
          image.src = 'chrome-extension://' + this.extensionId + '/icons/icon.png'
          image.onload = () => {
            const onMessageCallback = (event: any) => {
              if (event.detail.source === RECORDING_EXTENSION_SOURCE) {
                installed = true
              }
            }
            window.addEventListener('yesIAmHere', onMessageCallback)
            window.postMessage(
              {
                source: 'mindtickle',
                type: 'areYouThere',
                extensionId: this.extensionId
              },
              '*'
            )
            setTimeout(() => {
              if (installed) {
                resolve('installed-enabled')
              } else {
                return reject(new Error('installed-disabled'))
              }
              window.removeEventListener('yesIAmHere', onMessageCallback)
            }, 2000)
          }
          image.onerror = () => {
            return reject(new Error('not-installed'))
          }
        } else {
          return resolve('not-required')
        }
      }
    })
  }

  checkPermissions() {
    const type = this.type
    return new Promise((resolve, reject) => {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.enumerateDevices = async (callback: Function) => {
          const devices = navigator.mediaDevices.enumerateDevices()
          callback(devices)
        }
      }
      const MediaDevices: MediaDeviceInfo[] = []
      const isHTTPs = location.protocol === 'https:'
      let canEnumerate = false
      if (MediaStreamTrack && 'getSources' in MediaStreamTrack) {
        canEnumerate = true
      } else if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        canEnumerate = true
      }
      let hasMicrophone = false
      let hasSpeakers = false
      let hasWebcam = false

      let isMicrophoneAlreadyCaptured = false
      let isWebcamAlreadyCaptured = false

      function checkDeviceSupport() {
        if (!canEnumerate) {
          return
        }

        if (!navigator.enumerateDevices) {
          reject(new RecordingErrors(ERROR_CODES.BROWSER_NOT_SUPPORTED))
          return
        }
        const MediaDevices: MediaDeviceInfo[] = []
        navigator.enumerateDevices(function(devices: MediaDeviceInfo[]) {
          devices.forEach(function(_device: MediaDeviceInfo) {
            const device = _device

            let skip: boolean = false
            MediaDevices.forEach(function(d) {
              if (d.deviceId === device.deviceId && d.kind === device.kind) {
                skip = true
              }
            })
            if (skip) {
              return
            }

            if (device.label || !isChrome) {
              if (device.kind === 'videoinput' && !isWebcamAlreadyCaptured) {
                isWebcamAlreadyCaptured = true
              }
              if (device.kind === 'audioinput' && !isMicrophoneAlreadyCaptured) {
                isMicrophoneAlreadyCaptured = true
              }
            }
            if (device.kind === 'audioinput') {
              hasMicrophone = true
            }
            if (device.kind === 'audiooutput') {
              hasSpeakers = true
            }
            if (device.kind === 'videoinput') {
              hasWebcam = true
            }
            MediaDevices.push(device)
          })
          if (!hasMicrophone) {
            reject({ code: 'NO_MIC', message: 'No microphone found' })
          } else if (!hasWebcam && ((type as VideoType) || (type as ScreenVideoType))) {
            reject({ code: 'NO_CAM', message: 'No webcam found' })
          } else if (
            !isMicrophoneAlreadyCaptured &&
            !isWebcamAlreadyCaptured &&
            ((type as VideoType) || (type as ScreenVideoType))
          ) {
            reject({
              code: 'GET_PERMISSION_BOTH',
              message: 'Get permission for both webcam and mic'
            })
          } else if (
            !isWebcamAlreadyCaptured &&
            ((type as VideoType) || (type as ScreenVideoType))
          ) {
            reject({ code: 'GET_PERMISSION_CAM', message: 'Get permission for webcam' })
          } else if (!isMicrophoneAlreadyCaptured) {
            reject({ code: 'GET_PERMISSION_MIC', message: 'Get permission for mic' })
          } else {
            resolve()
          }
        })
      }
      checkDeviceSupport()
    })
  }
  async prepareRecording(onStopRecording: Function, onError: Function) {
    const tracker = this.tracker

    try {
      const constraints = await this.getMediaConstraints(convertRecordingTypeToQueueType(this.type))
      tracker.track('debug_event', {
        name: 'MediaConstraints',
        type: this.type,
        draftId: this.draftId,
        constraints: JSON.stringify(constraints)
      })

      try {
        const stream = await this.getMediaStream(constraints)
        this.stream = stream

        let options = { mimeType: 'video/webm' }
        switch (this.type.kind) {
          case 'screen-audio':
          case 'screen-video': {
            stream.getVideoTracks()[0].onended = () => {
              if (stream.getVideoTracks()[0].enabled) {
                onStopRecording()

                tracker.track('debug_event', {
                  name: 'StopSharingClicked',
                  type: this.type,
                  draftId: this.draftId
                })
              }
            }
            break
          }
          case 'audio': {
            stream.getAudioTracks()[0].onended = () => {
              tracker.track('debug_event', {
                name: 'prepareRecording: getAudioTracks: ended ',
                type: this.type,
                draftId: this.draftId
              })
              onStopRecording()
            }
            options = { mimeType: 'audio/webm' }
            break
          }
          case 'video': {
            stream.getAudioTracks()[0].onended = function() {
              tracker.track('debug_event', {
                name: 'prepareRecording: getAudioTracks: ended ',
                type: this.type,
                draftId: this.draftId
              })
              onStopRecording()
            }
            stream.getVideoTracks()[0].onended = function() {
              tracker.track('debug_event', {
                name: 'prepareRecording: getVideoTracks: ended ',
                type: this.type,
                draftId: this.draftId
              })
              onStopRecording()
            }
          }
        }

        this.mediaRecorder = new MediaRecorder(stream)
        this.mediaRecorder.ondataavailable = blob => {
          if (this.recordingState == 'stop') {
            return
          } else {
            if (this.recordingState == 'last-trickle') {
              this.recordingState = 'stop'
            }
            console.info('blob recieved === ', blob)
            if (isFirefox && (!blob.data || !blob.data.size)) {
              return
            }
            this.queue.handleBlob(blob).then(noop, err => {
              tracker.track('debug_event', {
                name: 'ErrorHandlingBlob',
                type: this.type,
                draftId: this.draftId,
                // chunkNumber: this.chunkSize.length + 1,
                error: JSON.stringify(err)
              })

              return onError(err)
            })
          }
        }
        this.recordIntervalId = setInterval(() => {
          if (this.mediaRecorder && this.mediaRecorder.state == 'recording') {
            this.mediaRecorder.requestData()
          }
        }, this.recordInterval)

        return stream
      } catch (err) {
        const errKeys = Object.keys(err).concat(Object.keys(Object.getPrototypeOf(err)))

        tracker.track('debug_event', {
          name: 'ErrorGettingMediaStreams',
          draftId: this.draftId,
          type: this.type,
          error: JSON.stringify(err, errKeys)
        })

        throw err
      }
    } catch (err) {
      const errKeys = Object.keys(err).concat(Object.keys(Object.getPrototypeOf(err)))
      tracker.track('debug_event', {
        name: 'ErrorGettingMediaConstraints',
        type: this.type,
        draftId: this.draftId,
        error: JSON.stringify(err, errKeys)
      })

      throw err
    }
  }

  async dismissRecording() {
    const tracker = this.tracker
    tracker.track('debug_event', {
      name: 'DismissRecordingType',
      type: this.type,
      draftId: this.draftId
    })
    if (this.recordIntervalId) {
      clearInterval(this.recordIntervalId)
      this.recordIntervalId = null
    }
    this.stopStream()
    if (this.queue) {
      this.queue.liveQueue = false
      await this.queue.stopProcessor()
      await this.queue.pushQueue()
      await this.queue.flushEverything()
    }
  }

  markLastMediaTrickle() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.requestData()
      this.recordingState = 'last-trickle'
      this.queue.setEndTime()
    }
  }
}
