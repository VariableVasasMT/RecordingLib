import { RecordStateType } from './types'

export const RECORDING_PREFIX = 'recording_'

export const RECORDING_STATUS = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  CANCELLED: 'Cancelled'
}

export const RECORDING_STATES: RecordStateType = {
  ACTIVE: 'active',
  STOP: 'stop',
  LAST_TRICKLE: 'last-trickle'
}

export const CHROME_STORE_URL = 'https://chrome.google.com/webstore/detail/'

export const RECORDING_EXTENSION_SOURCE = 'vs-recording-extension'

export const AudioQueue = 'audio'
export const VideoQueue = 'video'
export const ScreenQueue = 'screen'
