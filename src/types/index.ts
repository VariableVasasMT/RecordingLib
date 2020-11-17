export interface BaseService {
  mtRecorders: any
  onError: any
  onProgress: any
  onComplete: any
  onStop: any
  db: any
  awsService: any
}
export interface ServiceInitializeOptions {
  getCredentialsFn: Function
  region: String
  s3Bucket: String
  dbID: String
}

export interface ScreenMediaConstraints extends MediaTrackConstraints {
  mozMediaSource?: string
  mediaSource?: string
  mandatory?: {
    chromeMediaSource?: string
    chromeMediaSourceId?: string
    maxWidth?: number
    maxHeight?: number
  }
}

export interface ScreenMediaStreamConstraints extends MediaStreamConstraints {
  video: ScreenMediaConstraints
}
