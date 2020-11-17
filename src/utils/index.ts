import RecordingErrors, { ERROR_CODES } from '../error/'
import {
  RECORDING_EXTENSION_SOURCE,
  ScreenQueue,
  AudioQueue,
  VideoQueue
} from '../recording/constants'
import { ScreenMediaStreamConstraints } from '../types'
import { RecordingType, ScreenAudioType, ScreenVideoType, AudioType } from '../recording/types'
import { QueueTypes } from '../recording/queue/types'

export const noop = () => undefined

declare global {
  interface Window {
    opera: any
    chrome: any
    InstallTrigger: any

    webkitIndexedDB: IDBFactory
    mozIndexedDB: IDBFactory
    msIndexedDB: IDBFactory
  }
  interface Navigator {
    enumerateDevices: Function
    webkitGetUserMedia: (
      constraints: MediaStreamConstraints,
      successCallback: NavigatorUserMediaSuccessCallback,
      errorCallback: NavigatorUserMediaErrorCallback
    ) => void
    mozGetUserMedia: (
      constraints: MediaStreamConstraints,
      successCallback: NavigatorUserMediaSuccessCallback,
      errorCallback: NavigatorUserMediaErrorCallback
    ) => void
  }
}

export const isOpera: Boolean = !!window['opera'] || navigator.userAgent.indexOf(' OPR/') >= 0
export const isChrome = !!window.chrome && !isOpera // Chrome 1+
export const isFirefox = typeof window.InstallTrigger !== 'undefined' // Firefox 1.0+
export const isSafari = !!navigator.userAgent.match(/Version\/[\d\.]+.*Safari/)

export const browserVersion: String | Number = (function(): String | Number {
  const ua = navigator.userAgent
  let tem
  let M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || []
  if (/trident/i.test(M[1])) {
    tem = /\brv[ :]+(\d+)/g.exec(ua) || []
    return tem[1] || ''
  }
  if (M[1] === 'Chrome') {
    tem = ua.match(/\b(OPR|Edge)\/(\d+)/)
    if (tem !== null)
      return tem
        .slice(1)
        .join(' ')
        .replace('OPR', 'Opera')
  }
  M = M[2] ? [M[1], M[2]] : [navigator.appName, navigator.appVersion, '-?']
  tem = ua.match(/version\/(\d+)/i)
  if (tem !== null) M.splice(1, 1, tem[1])

  return parseInt(M[1], 10)
})()

export function getScreenId(extensionId: string): Promise<ScreenMediaStreamConstraints | null> {
  return new Promise((resolve, reject) => {
    if (isFirefox) {
      return resolve({
        video: {
          mozMediaSource: 'window',
          mediaSource: 'window'
        }
      })
    }

    const checkConnectionTimeout = setTimeout(function() {
      window.removeEventListener('yesIAmHere', onCheckConnection)
      reject(new RecordingErrors(ERROR_CODES.PERMISSION_DENIED_ERROR))
    }, 1000)

    const onCheckConnection = (event: any) => {
      if (event.detail.source === RECORDING_EXTENSION_SOURCE) {
        window.postMessage(
          {
            source: RECORDING_EXTENSION_SOURCE,
            type: 'getSourceId',
            extensionId,
            screenOptions: ['screen'],
            tabUrl: location.origin
          },
          '*'
        )
      }

      window.removeEventListener('yesIAmHere', onCheckConnection)
      clearTimeout(checkConnectionTimeout)
    }

    const onMessageCallback = (event: any) => {
      if (!event.detail) return resolve(null)
      if (event.detail.sourceId) {
        if (event.detail.err === 'PermissionDeniedError') {
          reject(new RecordingErrors(ERROR_CODES.SCREEN_PERMISSION_DENIED_ERROR))
        } else {
          resolve(getScreenConstraints(event.detail.sourceId))
        }
      }

      window.removeEventListener('getscreenid', onMessageCallback)
    }

    const k = window.addEventListener('getscreenid', onMessageCallback)
    const p = window.addEventListener('yesIAmHere', onCheckConnection)

    window.postMessage(
      { source: RECORDING_EXTENSION_SOURCE, type: 'areYouThere', extensionId },
      '*'
    )
  })
}

function getScreenConstraints(sourceId: string): ScreenMediaStreamConstraints {
  const screenConstraints: ScreenMediaStreamConstraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        maxWidth: 1280,
        maxHeight: 720
      }
    }
  }

  if (sourceId && screenConstraints?.video?.mandatory) {
    screenConstraints.video.mandatory.chromeMediaSourceId = sourceId
  }

  return screenConstraints
}

export const convertRecordingTypeToQueueType = (recordingType: RecordingType): QueueTypes => {
  if ((recordingType as ScreenAudioType) || (recordingType as ScreenVideoType)) return ScreenQueue
  if (recordingType as AudioType) return AudioQueue
  return VideoQueue
}
