export interface DeviceCapabilities {
  cores: number
  memoryGb: number | undefined
  maxTextureSize: number | undefined
}

export function getDeviceCapabilities(): DeviceCapabilities {
  const cores = navigator.hardwareConcurrency || 1
  const memoryGb = navigator.deviceMemory

  let maxTextureSize: number | undefined

  try {
    const canvas = document.createElement('canvas')
    let gl = canvas.getContext('webgl2')
    if (!gl) {
      gl = canvas.getContext('webgl')
    }
    if (gl) {
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    }
  } catch {
    // Ignore errors in headless/test environments
  }

  return {
    cores,
    memoryGb,
    maxTextureSize,
  }
}
