import { ErrorDescription } from "./constants";

export const ERROR_CREATOR = 'RECORDING_LIB'

export const getErrorDesc = (type:string): string => {
  return ErrorDescription[type] || type
}
export default class RecordingErrors extends Error {
  public type: string = ERROR_CREATOR
  public desc: string;
  constructor(type: string) {
    super(getErrorDesc(type));
    this.desc = getErrorDesc(type);
  }
}