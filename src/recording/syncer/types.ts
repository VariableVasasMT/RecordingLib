export type UploadStatusValueTypes = 'Active' | 'Inactive' | 'Cancelled'
export interface UploadStatusTypes {
  [key: string]: UploadStatusValueTypes
}

export type RecordingStatusValueTypes = 'Active' | 'Inactive' | 'Cancelled'
export interface RecordingStatusTypes {
  [key: string]: RecordingStatusValueTypes
}
