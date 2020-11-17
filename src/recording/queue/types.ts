import { TrackerInterface, AwsServiceInterface, RecordingType } from '../types'
import { QueueType } from 'aws-sdk/clients/connect'

export type QueueStatusType =
  | 'Done'
  | 'Loading'
  | 'Pending'
  | 'Stitching'
  | 'Error'
  | 'Delete'
  | 'Processing'
  | 'Uploading'
  | 'NoData'
export interface QueueStatusInterface {
  [key: string]: QueueStatusType
}

export type AudioQueueType = 'audio'
export type VideoQueueType = 'video'
export type ScreenQueueType = 'screen'
export type QueueTypes = VideoQueueType | AudioQueueType | ScreenQueueType
export interface QueueExtraInfo {
  concatUrl?: string
}

export interface S3ObjInterface {
  s3Path: string
  url: string
  type?: QueueType
}
export interface QueueInterface {
  tracker: TrackerInterface
  awsService: AwsServiceInterface
  uploadPath?: string
  stitchPath?: string
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
  liveQueue: boolean
  mediaKeys: Array<string>
  queueIntervalId: NodeJS.Timeout | null
  period: number
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
}

export type UploadStatusValueTypes = 'Active' | 'Inactive' | 'Cancelled'
export interface UploadStatusTypes {
  [key: string]: UploadStatusValueTypes
}

export type RecordingStatusValueTypes = 'Active' | 'Inactive' | 'Cancelled'
export interface RecordingStatusTypes {
  [key: string]: RecordingStatusValueTypes
}
