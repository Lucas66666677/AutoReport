import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Circle,
  CloudUpload,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react'
import { useScreenRecorder } from './useScreenRecorder'

const RECORDING_BUCKET = 'report_recordings'

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function createRecordingPath(userId: string, documentId: string | null): string {
  const safeDocumentId = documentId?.replace(/[^a-zA-Z0-9_-]/g, '') || 'unassigned'
  return `${userId}/${safeDocumentId}/${Date.now()}-${crypto.randomUUID()}.webm`
}

export default function ScreenRecorderControls({
  supabase,
  userId,
  documentId,
  onUploaded,
  onError,
}: {
  supabase: SupabaseClient | null
  userId: string | null
  documentId: string | null
  onUploaded?: (publicUrl: string) => void
  onError?: (message: string) => void
}) {
  const {
    status,
    elapsedSeconds,
    recordingBlob,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    clearRecording,
  } = useScreenRecorder()
  const [isUploading, setIsUploading] = useState(false)
  const [publicUrl, setPublicUrl] = useState<string | null>(null)
  const uploadedBlobRef = useRef<Blob | null>(null)

  useEffect(() => {
    if (!error) return
    onError?.(error)
  }, [error, onError])

  useEffect(() => {
    if (!recordingBlob || uploadedBlobRef.current === recordingBlob) return
    uploadedBlobRef.current = recordingBlob

    if (!supabase || !userId) {
      onError?.('請先登入並設定 Supabase，才能上傳錄影')
      return
    }

    let cancelled = false
    const uploadRecording = async () => {
      setIsUploading(true)
      setPublicUrl(null)

      try {
        const path = createRecordingPath(userId, documentId)
        const { error: uploadError } = await supabase.storage
          .from(RECORDING_BUCKET)
          .upload(path, recordingBlob, {
            contentType: recordingBlob.type || 'video/webm',
            cacheControl: '3600',
            upsert: false,
          })
        if (uploadError) throw uploadError

        const { data } = supabase.storage.from(RECORDING_BUCKET).getPublicUrl(path)
        if (!cancelled) {
          setPublicUrl(data.publicUrl)
          onUploaded?.(data.publicUrl)
        }
      } catch (caughtError) {
        if (!cancelled) {
          const message = caughtError instanceof Error ? caughtError.message : '錄影上傳失敗'
          onError?.(`錄影上傳失敗：${message}`)
        }
      } finally {
        if (!cancelled) setIsUploading(false)
      }
    }

    void uploadRecording()
    return () => {
      cancelled = true
    }
  }, [documentId, onError, onUploaded, recordingBlob, supabase, userId])

  const isActive = status === 'recording' || status === 'paused' || status === 'stopping'
  const canStart = Boolean(supabase && userId && documentId) && !isUploading

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5">
      {!isActive && status !== 'ready' ? (
        <button
          type="button"
          onClick={() => void startRecording()}
          disabled={!canStart || status === 'requesting'}
          className="grid h-6 w-6 place-items-center rounded-md text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
          title={status === 'requesting' ? '正在請求權限' : '開始錄影'}
          aria-label="開始錄影"
        >
          <Circle className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
        </button>
      ) : null}

      {status === 'recording' ? (
        <button
          type="button"
          onClick={pauseRecording}
          className="grid h-6 w-6 place-items-center rounded-md text-slate-600 transition hover:bg-white hover:text-slate-950"
          title="暫停錄影"
          aria-label="暫停錄影"
        >
          <Pause className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : null}

      {status === 'paused' ? (
        <button
          type="button"
          onClick={resumeRecording}
          className="grid h-6 w-6 place-items-center rounded-md text-slate-600 transition hover:bg-white hover:text-slate-950"
          title="繼續錄影"
          aria-label="繼續錄影"
        >
          <Play className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : null}

      {isActive ? (
        <button
          type="button"
          onClick={stopRecording}
          disabled={status === 'stopping'}
          className="grid h-6 w-6 place-items-center rounded-md text-red-600 transition hover:bg-red-50 disabled:opacity-35"
          title="停止錄影"
          aria-label="停止錄影"
        >
          <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
        </button>
      ) : null}

      <span
        className={`min-w-[4.3rem] font-mono text-[11px] tabular-nums ${
          isActive ? 'font-semibold text-slate-800' : 'text-slate-400'
        }`}
      >
        {formatDuration(elapsedSeconds)}
      </span>

      {isUploading ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <CloudUpload className="h-3.5 w-3.5 animate-pulse" />
          上傳中
        </span>
      ) : null}

      {publicUrl ? (
        <a
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
          className="grid h-6 w-6 place-items-center rounded-md text-emerald-600 transition hover:bg-emerald-50"
          title="開啟錄影"
          aria-label="開啟錄影"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
        </a>
      ) : null}

      {status === 'ready' && !isUploading ? (
        <button
          type="button"
          onClick={() => {
            setPublicUrl(null)
            uploadedBlobRef.current = null
            clearRecording()
          }}
          className="grid h-6 w-6 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
          title="錄製新影片"
          aria-label="錄製新影片"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  )
}
