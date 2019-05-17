export const DISK_FULL = 'DISK_FULL'
export const DB_NO_SUCH_KEY = 'DB_NO_SUCH_KEY'
export const DB_NO_SUCH_KEY_RETRY = 'DB_NO_SUCH_KEY_RETRY'
export const DB_ERROR_WHILE_GETTING_KEY = 'ERROR_GETTING_KEY'
export const DB_ERROR_WHILE_DELETING_KEY = 'ERROR_DELETING_KEY'
export const DB_ERROR_WHILE_PUTTING_KEY = 'ERROR_PUTTING_KEY'
export const DB_NOT_YET_OPEN = 'DB_NOT_YET_OPEN'
export const RECORDING_DISMISSED = 'RECORDING_DISMISSED'
export const AWS_LAMBDA_OBJECT_NOT_YET_INITIALIZED = 'AWS_LAMBDA_OBJECT_NOT_YET_INITIALIZED'
export const AWS_S3_OBJECT_NOT_YET_INITIALIZED = 'AWS_S3_OBJECT_NOT_YET_INITIALIZED'
export const AWS_NO_CREDENTIALS = 'AWS_NO_CREDENTIALS'
export const BROWSER_STALE = 'BROWSER_STALE'
export const MEDIA_CLOSE_UNEXPECTEDLY = 'MEDIA_CLOSE_UNEXPECTEDLY'
export const UPLOAD_FAILED = 'UPLOAD_FAILED'
export const SOMETHING_WENT_WRONG = 'SOMETHING_WENT_WRONG'
export const UPLOAD_ABORTED_DUE_TO_ERROR = 'UPLOAD_ABORTED_DUE_TO_ERROR'
export const UPLOAD_FAILED_DUE_TO_NETWORK_ERROR = 'UPLOAD_FAILED_DUE_TO_NETWORK_ERROR'
export const PERMISSION_DENIED_ERROR = 'PERMISSION_DENIED_ERROR'
export const USER_DIMISSED = 'USER_DIMISSED'
export const SCREEN_PERMISSION_DENIED_ERROR = 'SCREEN_PERMISSION_DENIED_ERROR'
export const NETWORK_ERROR = 'NETWORK_ERROR'

interface ErrorDesc {
  [key: string]: string;
}
export const ErrorDescription: ErrorDesc = {
  [DISK_FULL]: 'The disk on system is full',
  [DB_NO_SUCH_KEY]: 'There is no key available in db',
  [DB_NO_SUCH_KEY_RETRY]: 'We tried, really there is no such key',
  [DB_ERROR_WHILE_GETTING_KEY]: 'While accessing key in db, there was an error',
  [DB_ERROR_WHILE_DELETING_KEY]: 'Error while deleting key in DB',
  [DB_ERROR_WHILE_PUTTING_KEY]: 'Error while creating key in DB',
  [DB_NOT_YET_OPEN]: 'DB is not available yet',
  [RECORDING_DISMISSED]: 'Recording has been dismissed',
  [AWS_LAMBDA_OBJECT_NOT_YET_INITIALIZED]: 'lambda object not initialized yet',
  [AWS_S3_OBJECT_NOT_YET_INITIALIZED]: 'AWS S3 object not yet initialized',
  [AWS_NO_CREDENTIALS]: 'No AWS credentials',
  [BROWSER_STALE]: 'Browser has gone state, restart browser',
  [MEDIA_CLOSE_UNEXPECTEDLY]: 'Media access closed, unexpectedly',
  [UPLOAD_FAILED]: 'upload failed, will keep retrying!',
  [SOMETHING_WENT_WRONG]: 'We dont know what went wrong',
  [UPLOAD_ABORTED_DUE_TO_ERROR]: 'Upload aborted due to error, we are going to retry',
  [UPLOAD_FAILED_DUE_TO_NETWORK_ERROR]: 'Network has failed us',
  [PERMISSION_DENIED_ERROR]: 'Permission denied!',
  [USER_DIMISSED]: 'User has dismissed recording',
  [SCREEN_PERMISSION_DENIED_ERROR]: 'Screen persmission has been denied',
  [NETWORK_ERROR]: 'Network error!'
}
