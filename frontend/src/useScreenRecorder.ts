import { useCallback, useEffect, useRef, useState } from 'react'

export type ScreenRecorderStatus =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'ready'
  | 'error'

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''

  return (
    [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
  )
}

export function useScreenRecorder() {
  const [status, setStatus] = useState<ScreenRecorderStatus>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamsRef = useRef<MediaStream[]>([])
  const chunksRef = useRef<BlobPart[]>([])

  const releaseStreams = useCallback(() => {
    streamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop())
    })
    streamsRef.current = []
  }, [])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      releaseStreams()
      return
    }

    setStatus('stopping')
    recorder.stop()
  }, [releaseStreams])

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices?.getUserMedia) {
      setError('此瀏覽器不支援螢幕錄影')
      setStatus('error')
      return
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('此瀏覽器不支援 MediaRecorder')
      setStatus('error')
      return
    }

    setStatus('requesting')
    setError(null)
    setRecordingBlob(null)
    setElapsedSeconds(0)
    chunksRef.current = []

    let displayStream: MediaStream | null = null
    let microphoneStream: MediaStream | null = null

    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      })
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...microphoneStream.getAudioTracks(),
      ])
      streamsRef.current = [displayStream, microphoneStream, combinedStream]

      const mimeType = getSupportedMimeType()
      const recorder = new MediaRecorder(
        combinedStream,
        mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined,
      )
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        setError('錄影時發生錯誤')
        setStatus('error')
        releaseStreams()
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'video/webm',
        })
        mediaRecorderRef.current = null
        releaseStreams()

        if (blob.size === 0) {
          setError('沒有取得可用的錄影內容')
          setStatus('error')
          return
        }

        setRecordingBlob(blob)
        setStatus('ready')
      }

      displayStream.getVideoTracks()[0]?.addEventListener('ended', stopRecording, {
        once: true,
      })
      recorder.start(1_000)
      setStatus('recording')
    } catch (caughtError) {
      displayStream?.getTracks().forEach((track) => track.stop())
      microphoneStream?.getTracks().forEach((track) => track.stop())
      releaseStreams()

      const isPermissionError =
        caughtError instanceof DOMException &&
        (caughtError.name === 'NotAllowedError' || caughtError.name === 'AbortError')
      setError(isPermissionError ? '螢幕或麥克風權限未授予' : '無法開始螢幕錄影')
      setStatus('error')
    }
  }, [releaseStreams, stopRecording])

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    recorder.pause()
    setStatus('paused')
  }, [])

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'paused') return
    recorder.resume()
    setStatus('recording')
  }, [])

  const clearRecording = useCallback(() => {
    setRecordingBlob(null)
    setElapsedSeconds(0)
    setError(null)
    setStatus('idle')
  }, [])

  useEffect(() => {
    if (status !== 'recording') return
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [status])

  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      releaseStreams()
    },
    [releaseStreams],
  )

  return {
    status,
    elapsedSeconds,
    recordingBlob,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    clearRecording,
  }
}
