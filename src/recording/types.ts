import { QueueInterface } from './queue/types'
import BaseRecorder from './baseRecorder'

export interface VideoType {
  kind: 'video'
}

export interface ScreenAudioType {
  kind: 'screen-audio'
}

export interface ScreenVideoType {
  kind: 'screen-video'
}

export interface AudioType {
  kind: 'audio'
}
export type RecordingType = VideoType | ScreenAudioType | ScreenVideoType | AudioType

export interface State {
  name: string
  description: string
}

export interface RecordingServiceInterface {
  mtRecorders: any
  onError: any
  onProgress: any
  onComplete: any
  onStop: any
  db: any
  awsService: any
}

export interface TrackerInterface {
  track: Function
}

/**
 * @augments extensionId id for the extension for screen recording //TODO : add extension code as well and add url here
 */
export interface RecordingServiceOptionsInterface {
  DB_ID: string
  type: any
  draftId: string
  region: any
  s3Bucket: string
  devices: any
  tracker: TrackerInterface
  onStop: Function
  uploadPathFn: Function
  stitchPathFn: Function
  getCredentialsFn: Function
  extensionId: string
}

export interface DeviceListInterface {
  [key: string]: DeviceInterface
}
export interface DeviceInterface {
  kind: string
  deviceId: string
  label?: string
}

export interface DeviceMapInterface {
  [key: string]: Array<DeviceInterface>
}

export interface BaseDeviceIdInterface {
  audio: boolean | string
  video: boolean | string
}
export interface SyncerInterface {
  loadQueuesFromDB: Function
  setRecordingStatus: Function
  getRecordingStatus: Function
  allQueues: QueueInterface[]
  attachQueue: (q: QueueInterface) => void
}

export interface AwsServiceInterface {
  credentialFn: Function
  credentialPromise?: Promise<any>
  region: string
  s3Bucket: string
  fetchCredentials: Function
  invokeLambda: Function
  invokeLambdaForConcat: Function
  uploadToS3: Function
  s3SignedUrl: Function
}

export interface AWSCredentialInterface {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}
export interface AWSConfigInterface extends AWSCredentialInterface {
  region: string
  correctClockSkew: boolean
}

export interface S3ErrorInterface extends Error {
  code?: string
}

export interface ChildRecorders extends Object {
  screen?: BaseRecorder
  video?: BaseRecorder
  audio: BaseRecorder
}

export type RecordStateValueTypes = 'active' | 'stop' | 'last-trickle'

export type MediaTrackType = MediaTrackConstraints | undefined | boolean
export interface RecordStateType {
  [key: string]: RecordStateValueTypes
}
