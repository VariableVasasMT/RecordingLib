export const dataUriToBlobSync = (dataURI: string): Blob => {
  let byteString
  let mimeString
  let buffer
  let array

  // convert base64 to raw binary data held in a string
  // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that
  // does this
  byteString = atob(dataURI.split('base64')[1].substr(1))

  // separate out the mime component
  mimeString = dataURI
    .split('base64')[0]
    .split(':')[1]
    .split(';')[0]

  // write the bytes of the string to an ArrayBuffer
  buffer = new ArrayBuffer(byteString.length)
  array = new Uint8Array(buffer)

  for (let i = 0; i < byteString.length; i++) {
    array[i] = byteString.charCodeAt(i)
  }

  // write the ArrayBuffer to a blob
  return new Blob([array], { type: mimeString })
}

/**
 * The inverse of blobToDataUri, that converts a dataURL back to a Blob
 *
 * @param  {string} dataURI dataURI
 * @return {Promise}
 */
export const dataUriToBlob = (dataURI: string): Promise<Blob> => {
  let blob: Blob
  return new Promise((resolve, reject) => {
    try {
      blob = dataUriToBlobSync(dataURI)
      resolve(blob)
    } catch (e) {
      reject(e)
    }
  })
}
