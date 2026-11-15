import React, { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ProfanityIncident, VideoAnalysisReport } from "../types/analysis";
import { formatSecondsToMMSS, getSeverityMeta } from "../utils/formatters";

interface VideoStageProps {
  videoUrl: string;
  report: VideoAnalysisReport;
  activeIncidentId: string | null;
  seekRequest: { incident: ProfanityIncident; nonce: number } | null;
  masked: boolean;
  onTimeUpdate: (timeSeconds: number) => void;
  onSelectIncident: (incident: ProfanityIncident) => void;
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5];

export const VideoStage: React.FC<VideoStageProps> = ({
  videoUrl,
  report,
  activeIncidentId,
  seekRequest,
  masked,
  onTimeUpdate,
  onSelectIncident,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(report.videoDurationSeconds || 0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [autoMuteEnabled, setAutoMuteEnabled] = useState(false);
  const [isCurrentlyAutoMuted, setIsCurrentlyAutoMuted] = useState(false);
  const [videoPlaybackError, setVideoPlaybackError] = useState(false);

  useEffect(() => {
    setVideoPlaybackError(false);
    setCurrentTime(0);
    setIsPlaying(false);
    setMediaDuration(report.videoDurationSeconds || 0);
  }, [videoUrl, report.videoDurationSeconds]);

  const effectiveDuration =
    mediaDuration > 0
      ? mediaDuration
      : report.videoDurationSeconds > 0
      ? report.videoDurationSeconds
      : 1;

  // Handle seek request from incident list or timeline click
  useEffect(() => {
    if (!seekRequest || !videoRef.current) return;
    const targetTime = Math.max(0, seekRequest.incident.startTimeSeconds - 1);
    videoRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
    void videoRef.current.play().catch(() => {});
  }, [seekRequest]);

  // Apply playback rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Sync auto-mute state during profanity intervals
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!autoMuteEnabled) {
      if (isCurrentlyAutoMuted) {
        video.muted = false;
        setIsCurrentlyAutoMuted(false);
      }
      return;
    }

    const inProfanityWindow = report.incidents.some(
      (inc) =>
        currentTime >= inc.startTimeSeconds - 0.15 &&
        currentTime <= inc.endTimeSeconds + 0.15
    );

    if (inProfanityWindow && !isCurrentlyAutoMuted) {
      video.muted = true;
      setIsCurrentlyAutoMuted(true);
    } else if (!inProfanityWindow && isCurrentlyAutoMuted) {
      video.muted = false;
      setIsCurrentlyAutoMuted(false);
    }
  }, [autoMuteEnabled, currentTime, isCurrentlyAutoMuted, report.incidents]);

  const activeIncident = report.incidents.find(
    (inc) => currentTime >= inc.startTimeSeconds - 0.3 && currentTime <= inc.endTimeSeconds + 0.8
  );

  const handleTogglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const handleTimelineScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !videoRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * effectiveDuration;
    videoRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const jumpRelativeIncident = (direction: -1 | 1) => {
    if (report.incidents.length === 0) return;
    const currentIndex = report.incidents.findIndex((i) => i.id === activeIncidentId);
    let nextIndex = 0;
    if (currentIndex === -1) {
      if (direction === 1) {
        const after = report.incidents.findIndex((i) => i.startTimeSeconds > currentTime);
        nextIndex = after !== -1 ? after : 0;
      } else {
        const before = [...report.incidents]
          .reverse()
          .findIndex((i) => i.startTimeSeconds < currentTime - 1.5);
        nextIndex = before !== -1 ? report.incidents.length - 1 - before : report.incidents.length - 1;
      }
    } else {
      nextIndex =
        (currentIndex + direction + report.incidents.length) % report.incidents.length;
    }
    onSelectIncident(report.incidents[nextIndex]);
  };

  const progressPercent = Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100));

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Video Viewport */}
      <div className="relative bg-slate-950 aspect-video">
        {videoPlaybackError ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-slate-300">
            <p className="text-sm font-semibold text-white">
              브라우저에서 이 영상 코덱을 직접 미리보기할 수 없습니다
            </p>
            <p className="mt-1.5 text-xs text-slate-400 max-w-md leading-relaxed">
              서버에서 영상 압축 변환 후 AI 분석은 정상 완료되었습니다. 오른쪽 장면 목록에서 발화 타임스탬프와 내용을 확인하실 수 있습니다.
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              setVideoPlaybackError(false);
              const dur = e.currentTarget.duration;
              if (Number.isFinite(dur) && dur > 0) setMediaDuration(dur);
            }}
            onError={() => setVideoPlaybackError(true)}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime;
              setCurrentTime(t);
              onTimeUpdate(t);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            className="w-full h-full object-contain"
          />
        )}

        {/* Measured Scrim Overlay for Active Incident Caption */}
        {activeIncident && (
          <div className="pointer-events-none absolute inset-x-0 bottom-12 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pt-8 pb-3 text-white">
            <div className="flex items-center justify-between gap-3 text-xs text-slate-200 mb-1">
              <span className="font-mono tabular-nums">
                {activeIncident.timestampDisplay} · {getSeverityMeta(activeIncident.severity).label} ·{" "}
                {activeIncident.speakerDescription}
              </span>
              {isCurrentlyAutoMuted && (
                <span className="font-medium text-amber-300">자동 음소거 적용 중</span>
              )}
            </div>
            <p className="text-sm sm:text-base font-medium leading-snug">
              {masked ? activeIncident.maskedUtterance : activeIncident.fullUtterance}
            </p>
          </div>
        )}
      </div>

      {/* Interactive Profanity Marker Timeline */}
      <div className="p-4 sm:p-5 border-t border-slate-200 space-y-4">
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>감지 지점 타임라인 (마커를 클릭하면 해당 장면 1초 전으로 이동합니다)</span>
            <span className="font-mono tabular-nums text-slate-700 font-medium">
              {formatSecondsToMMSS(currentTime)} / {formatSecondsToMMSS(effectiveDuration)}
            </span>
          </div>

          {/* Clickable Scrubber Track */}
          <div
            ref={progressBarRef}
            onClick={handleTimelineScrub}
            role="slider"
            aria-label="영상 타임라인 탐색"
            aria-valuemin={0}
            aria-valuemax={Math.round(effectiveDuration)}
            aria-valuenow={Math.round(currentTime)}
            tabIndex={0}
            className="relative h-8 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer select-none overflow-hidden"
          >
            {/* Current Progress Fill */}
            <div
              className="absolute inset-y-0 left-0 bg-blue-100/80 transition-[width] duration-75"
              style={{ width: `${progressPercent}%` }}
            />

            {/* Incident Markers */}
            {report.incidents.map((inc) => {
              const leftPct = Math.min(
                98.5,
                Math.max(1.5, (inc.startTimeSeconds / effectiveDuration) * 100)
              );
              const meta = getSeverityMeta(inc.severity);
              const isActive = inc.id === activeIncidentId;
              return (
                <button
                  key={inc.id}
                  type="button"
                  title={`${inc.timestampDisplay} · ${meta.label} (${
                    masked ? inc.maskedExpression : inc.detectedExpression
                  })`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectIncident(inc);
                  }}
                  style={{ left: `${leftPct}%` }}
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-6 rounded-sm transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 ${
                    meta.markerColor
                  } ${isActive ? "scale-y-125 ring-2 ring-slate-900 z-10" : "opacity-85 hover:opacity-100 hover:scale-110"}`}
                />
              );
            })}

            {/* Playhead */}
            <div
              className="absolute inset-y-0 w-0.5 bg-blue-700 pointer-events-none z-20"
              style={{ left: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Transport & Safety Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTogglePlay}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? "일시정지" : "재생"}
            </button>

            <button
              type="button"
              disabled={report.incidents.length === 0}
              onClick={() => jumpRelativeIncident(-1)}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              이전 장면
            </button>

            <button
              type="button"
              disabled={report.incidents.length === 0}
              onClick={() => jumpRelativeIncident(1)}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              다음 장면
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Playback Speed */}
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg">
              {PLAYBACK_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setPlaybackRate(rate)}
                  className={`px-2 py-1 text-xs font-mono tabular-nums rounded-md transition-colors cursor-pointer ${
                    playbackRate === rate
                      ? "bg-white text-slate-900 font-semibold shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Auto-Mute Profanity Segment Toggle */}
            <button
              type="button"
              onClick={() => setAutoMuteEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoMuteEnabled
                  ? "bg-blue-50 border-blue-200 text-blue-800"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {autoMuteEnabled ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
              {autoMuteEnabled ? "욕설 구간 자동 음소거 켜짐" : "욕설 구간 자동 음소거"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
