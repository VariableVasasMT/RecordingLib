export interface VideoType {
  kind: "video",
}

export interface ScreenAudioType {
  kind: "screen-audio"
}

export interface ScreenVideoType {
  kind: "screen-audio"
}

export interface AudioType {
  kind: "audio"
}
export type RecordingType = VideoType | ScreenAudioType | ScreenVideoType | AudioType;

export interface State {
  name: string,
  description: string
}

