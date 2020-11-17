import AWS, { Lambda } from 'aws-sdk'

import { noop } from '../utils/'
import {
  AwsServiceInterface,
  AWSConfigInterface,
  TrackerInterface,
  AWSCredentialInterface,
  S3ErrorInterface
} from '../recording/types'
import { LambdaType } from './types'
import RecordingErrors from '../error'

class AWSConfig implements AWSConfigInterface {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  region: string
  correctClockSkew: boolean
  constructor(accessKeyId: string, secretAccessKey: string, sessionToken: string, region: string) {
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.sessionToken = sessionToken
    this.region = region
    this.correctClockSkew = true
  }
}

export default class AwsService implements AwsServiceInterface {
  credentialFn: Function
  credentialPromise!: Promise<AWSCredentialInterface>
  region: string
  tracker: TrackerInterface
  private hasCredentials: boolean
  private getFedSmallIntervalId!: NodeJS.Timeout
  s3Bucket: string

  constructor(
    getCredentialsFn: Function,
    region: string,
    s3Bucket: string,
    tracker: TrackerInterface
  ) {
    this.credentialFn = getCredentialsFn
    this.region = region
    this.hasCredentials = false
    this.s3Bucket = s3Bucket
    this.tracker = tracker
  }

  fetchCredentials(): Promise<AWSCredentialInterface> {
    if (!this.credentialPromise) {
      this.credentialPromise = this.credentialFn()
    }

    return this.credentialPromise
  }

  private _reFetchCredentials(): Promise<AWSCredentialInterface> {
    this.tracker.track('debug_event', 're-fetching credentials')
    delete this.credentialPromise
    return this.fetchCredentials()
  }

  private async _getAWSConfig() {
    const credentials: AWSCredentialInterface = this.credentialPromise
      ? await this.credentialPromise
      : await this.fetchCredentials()

    this.tracker.track(
      'debug_event',
      `region is ${this.region} creds are ${JSON.stringify(credentials)}`
    )

    return new AWSConfig(
      credentials.accessKeyId,
      credentials.secretAccessKey,
      credentials.sessionToken,
      this.region
    )
  }

  private async _getLambda(): Promise<Lambda> {
    const awsConfig = await this._getAWSConfig()

    return new AWS.Lambda(awsConfig)
  }

  private async _getS3() {
    console.log('getting s3')
    const awsConfig = await this._getAWSConfig()
    const s3 = new AWS.S3(awsConfig)

    return s3
  }

  updateCredentials() {
    this.hasCredentials = false
    this.credentialFn()
    clearInterval(this.getFedSmallIntervalId)
    this.getFedSmallIntervalId = setInterval(async () => {
      await this._reFetchCredentials()
    }, 20000)
  }

  // initialize() {
  // 	var deferred = $q.defer();
  // 	var intervalId = setInterval(
  // 		() => {
  // 			if (cname && learnerJson.id && companySettings.cdnId) {
  // 				clearInterval(intervalId);
  // 				this.updateCredentials();
  // 				clearInterval(fedUpdateIntervalId);
  // 				fedUpdateIntervalId = setInterval(updateCredentials, fedUpdateInterval);
  // 				deferred.resolve();
  // 			}
  // 		}, 1000);
  // 	return deferred.promise;
  // };

  invokeLambda(params: Lambda.InvocationRequest) {
    return new Promise(async (resolve, reject) => {
      try {
        const lambda = await this._getLambda()
        const that = this
        lambda.invoke(params, async function(
          this: LambdaType,
          err: AWS.AWSError,
          data: Lambda.InvocationResponse
        ) {
          /* tslint:disable */
          const requestId = this.request.response?.requestId
          /* tslint:enable */
          if (err) {
            err.requestId = requestId
            if (err.code === 'NetworkingError') {
              await that.invokeLambda(params)
            } else if (err.code === 'ExpiredToken') {
              console.log('Expired Token reinitializing')
              await that._reFetchCredentials()
            }
            console.log(err)
            reject(err)
          } else {
            if (data && data.FunctionError) {
              const error = new RecordingErrors(
                data?.Payload ? JSON.parse(data?.Payload as string)?.errorMessage : 'Error',
                requestId
              )
              reject(error)
            } else {
              resolve({ requestId, data })
            }
          }
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  invokeLambdaForConcat(s3FilePath: string, mediaKeys: string[], contentType: string) {
    if (mediaKeys.length > 0) {
      this.tracker.track('debug_event', 'Invoke Lambda for concat', mediaKeys, s3FilePath)
      const args = JSON.stringify({
        aggregateMediaS3Key: s3FilePath,
        bucket: this.s3Bucket,
        mediaKeys,
        contentType
      })
      const params: Lambda.InvocationRequest = {
        FunctionName: 'ConcatMediaMission',
        InvocationType: 'RequestResponse',
        Payload: args
      }

      return this.invokeLambda(params)
    } else {
      return Promise.reject(new Error('No media keys to concat'))
    }
  }

  async uploadToS3(s3FilePath: string, s3Filedata: Blob) {
    console.log('Uploading to S3', s3FilePath)
    const params = {
      Bucket: this.s3Bucket,
      Key: s3FilePath,
      Body: s3Filedata
    }
    const s3 = await this._getS3()

    return new Promise((resolve, reject) => {
      s3.upload(params, async (err: S3ErrorInterface, data: AWS.S3.ManagedUpload.SendData) => {
        if (err) {
          this.tracker.track('debug_event', 'S3 error', err.code, data)
          if (err.code === 'NetworkingError') {
            await this.uploadToS3(s3FilePath, s3Filedata)
          } else if (err.code === 'ExpiredToken') {
            this.tracker.track('debug_event', 'Expired Token reinitializing')
            try {
              await this._reFetchCredentials()
              await this.uploadToS3(s3FilePath, s3Filedata).then(result => resolve(result))
            } catch (e) {
              return reject(e)
            }
          } else {
            this.tracker.track('debug_event', 'Error in get s3', err, data)
          }
          return reject(err)
        }

        resolve(params.Key)
      })
    })
  }

  async s3SignedUrl(path: string) {
    return new Promise(async (resolve, reject) => {
      try {
        const s3 = await this._getS3()

        const params = {
          Bucket: this.s3Bucket,
          Key: path
        }
        // if(!s3) {
        //   throw new MTError(ErrorCode.AWS_S3_OBJECT_NOT_YET_INITIALIZED, {retry: true})
        // }

        s3.getSignedUrl('getObject', params, async (err: S3ErrorInterface, url) => {
          if (err) {
            if (err.code === 'ExpiredToken') {
              this.tracker.track('debug_event', 'Expired Token reinitializing')
              try {
                await this._reFetchCredentials()
                await this.s3SignedUrl(path).then(url => resolve(url))
              } catch (e) {
                return reject(err)
              }
            }

            return reject(err)
          }

          return resolve(url)
        })
      } catch (e) {
        reject(e)
      }
    })
  }
}
