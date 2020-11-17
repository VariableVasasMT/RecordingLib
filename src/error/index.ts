import { ErrorDescription } from './constants'
export { ERROR_CODES } from './constants'

export const ERROR_CREATOR = 'RECORDING_LIB'

export const getErrorDesc = (type: string): string => {
  return ErrorDescription[type] || type
}
export default class RecordingErrors extends Error {
  public type: string = ERROR_CREATOR
  public desc: string
  public requestId?: string
  constructor(type: string, requestId?: string) {
    super(getErrorDesc(type))
    this.type = type
    this.requestId = requestId
    this.desc = getErrorDesc(type)
  }
}
