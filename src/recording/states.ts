import { State } from "./types";

export class States {
  public INIT: State = { name: "INIT", description: "library in the process of initialization"};
  public PREPARING: State = { name: "PREPARING", description: "Preparing the connections to DB and checking queues"};
  public CHECK_PERMISSION: State = { name: "CHECK_PERMISSION", description: "library checking for media permissions"};
  public CHECK_UPLOADING: State = { name: "CHECK_UPLOADING", description: "library checking if uploads are pending from previous states"};
  public CHECK_STITCHING: State = { name: "CHECK_STITCHING", description: "library checking if stitching in progress"};
  public CHECK_PROCESSING: State = { name: "CHECK_PROCESSING", description: "library checking if processing"};
  public ERROR: State = { name: "ERROR", description: "There was an error"};
  public RECORDING: State = { name: "RECORDING", description: "library is recording"};
  public PAUSED: State = { name: "PAUSED", description: "library has a recording paused"};
  public DONE: State = { name: "DONE", description: "library the recording is done with cleaning"};
  public CLEANING: State = { name: "CLEANING", description: "library ready for recording"};
}